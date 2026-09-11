/// <reference path="../../cloudflare-env.d.ts" />

/**
 * TunnelRoomV2 — one Durable Object instance per open clipboard-tunnel code.
 *
 * Transport: Hibernatable WebSockets. Connections stay open with no polling
 * cost; the instance can unload from memory between messages and wakes only
 * when a message/ping arrives. Presence (display name, whether the peer
 * already passed the password check) is stored via
 * ws.serializeAttachment() — plain instance fields don't survive
 * hibernation, but attachments do.
 *
 * History: the last MAX_HISTORY messages live in this DO's own
 * `state.storage` (LRU — oldest dropped on overflow), not D1. When the last
 * peer disconnects, storage is wiped and any R2 objects referenced by
 * pending file messages are deleted (see cleanup.ts's cron never looks at
 * tunnel-produced R2 keys — this DO is the only thing that ever deletes
 * them).
 */

import { DurableObject } from "cloudflare:workers";
import { verifyPassword } from "../share/password";
import { deleteS3Object } from "../s3/cleanup";
import { bucketName } from "../s3/client";
import { putS3Object } from "../s3/put";

export const MAX_PEERS = 4;
export const MAX_HISTORY = 10;
export const INLINE_MAX_BYTES = 1024 * 1024; // 1 MB

interface PeerAttachment {
	id: string;
	displayName: string;
	authed: boolean;
	lastSeen: number;
}

type ClientMessage =
	| { type: "join"; displayName: string; password?: string }
	| { type: "text"; body: string }
	| { type: "file"; filename: string; contentType: string; sizeBytes: number; dataBase64: string }
	| { type: "share-link"; filename: string; sizeBytes: number; shareUrl: string; shareToken: string }
	| { type: "ping" };

export interface TunnelHistoryItem {
	seq: number;
	kind: "text" | "file" | "share-link" | "presence";
	from: string;
	fromId: string;
	createdAt: number;
	body?: string;
	filename?: string;
	sizeBytes?: number;
	r2Key?: string;
	contentType?: string;
	shareUrl?: string;
	presenceEvent?: "joined" | "left";
}

export class TunnelRoomV2 extends DurableObject<CloudflareEnv> {
	private passwordHash: string | null = null;
	private passwordSalt: string | null = null;
	private configLoaded = false;

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("Upgrade") !== "websocket") {
			return new Response("Expected WebSocket Upgrade", { status: 426 });
		}

		const url = new URL(request.url);
		const displayName = (url.searchParams.get("name") ?? "").slice(0, 32).trim() || "anon";
		const password = url.searchParams.get("password") ?? "";

		await this.loadConfig();

		const activePeers = this.ctx.getWebSockets();
		if (activePeers.length >= MAX_PEERS) {
			return new Response("Tunnel is full", { status: 403 });
		}

		if (this.passwordHash && this.passwordSalt) {
			const ok = await verifyPassword(password, this.passwordSalt, this.passwordHash);
			if (!ok) {
				return new Response("Invalid password", { status: 401 });
			}
		}

		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);

		this.ctx.acceptWebSocket(server);
		const attachment: PeerAttachment = {
			id: crypto.randomUUID(),
			displayName,
			authed: true,
			lastSeen: Date.now(),
		};
		server.serializeAttachment(attachment);

		await this.appendHistory({
			kind: "presence",
			from: displayName,
			fromId: attachment.id,
			presenceEvent: "joined",
		});
		// Broadcast to existing peers only — the new connection will see this
		// same event once, via the history replay below, not twice.
		this.broadcast({ type: "presence", event: "joined", displayName, id: attachment.id }, server);
		server.send(JSON.stringify({ type: "welcome", id: attachment.id }));
		await this.sendHistoryTo(server);
		this.broadcastRoster();

		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
		if (typeof raw !== "string") return;
		let msg: ClientMessage;
		try {
			msg = JSON.parse(raw);
		} catch {
			return;
		}

		const attachment = ws.deserializeAttachment() as PeerAttachment | null;
		if (!attachment) return;

		if (msg.type === "ping") {
			attachment.lastSeen = Date.now();
			ws.serializeAttachment(attachment);
			ws.send(JSON.stringify({ type: "pong" }));
			return;
		}

		if (msg.type === "text") {
			const body = msg.body.slice(0, INLINE_MAX_BYTES);
			const item = await this.appendHistory({
				kind: "text",
				from: attachment.displayName,
				fromId: attachment.id,
				body,
			});
			this.broadcast({ type: "text", from: attachment.displayName, id: attachment.id, body, seq: item.seq, createdAt: item.createdAt });
			return;
		}

		if (msg.type === "file") {
			await this.handleFile(ws, attachment, msg);
			return;
		}

		if (msg.type === "share-link") {
			const item = await this.appendHistory({
				kind: "share-link",
				from: attachment.displayName,
				fromId: attachment.id,
				filename: msg.filename,
				sizeBytes: msg.sizeBytes,
				shareUrl: msg.shareUrl,
			});
			this.broadcast({
				type: "share-link",
				from: attachment.displayName,
				id: attachment.id,
				filename: msg.filename,
				sizeBytes: msg.sizeBytes,
				shareUrl: msg.shareUrl,
				seq: item.seq,
				createdAt: item.createdAt,
			});
		}
	}

	async webSocketClose(ws: WebSocket): Promise<void> {
		const attachment = ws.deserializeAttachment() as PeerAttachment | null;
		const displayName = attachment?.displayName ?? "someone";
		const id = attachment?.id ?? crypto.randomUUID();

		await this.appendHistory({ kind: "presence", from: displayName, fromId: id, presenceEvent: "left" });
		this.broadcast({ type: "presence", event: "left", displayName, id }, ws);
		this.broadcastRoster();

		const remaining = this.ctx.getWebSockets().filter((s) => s !== ws);
		if (remaining.length === 0) {
			await this.wipeRoom();
		}
	}

	async webSocketError(ws: WebSocket): Promise<void> {
		await this.webSocketClose(ws);
	}

	// ── Config (password) ────────────────────────────────────────────────

	private async loadConfig(): Promise<void> {
		if (this.configLoaded) return;
		const stored = await this.ctx.storage.get<{ passwordHash: string | null; passwordSalt: string | null }>(
			"config",
		);
		this.passwordHash = stored?.passwordHash ?? null;
		this.passwordSalt = stored?.passwordSalt ?? null;
		this.configLoaded = true;
	}

	/** Called once, right after creation, via the /api/tunnel create route. */
	async setPassword(passwordHash: string | null, passwordSalt: string | null): Promise<void> {
		this.passwordHash = passwordHash;
		this.passwordSalt = passwordSalt;
		this.configLoaded = true;
		await this.ctx.storage.put("config", { passwordHash, passwordSalt });
	}

	// ── History (LRU in DO storage) ──────────────────────────────────────

	private async appendHistory(
		item: Omit<TunnelHistoryItem, "seq" | "createdAt">,
	): Promise<TunnelHistoryItem> {
		const seq = ((await this.ctx.storage.get<number>("seq")) ?? 0) + 1;
		await this.ctx.storage.put("seq", seq);
		const full: TunnelHistoryItem = { ...item, seq, createdAt: Date.now() };
		await this.ctx.storage.put(`msg:${String(seq).padStart(10, "0")}`, full);

		const keys = [...(await this.ctx.storage.list<TunnelHistoryItem>({ prefix: "msg:" })).keys()];
		if (keys.length > MAX_HISTORY) {
			const toDelete = keys.slice(0, keys.length - MAX_HISTORY);
			for (const key of toDelete) {
				const old = await this.ctx.storage.get<TunnelHistoryItem>(key);
				if (old?.r2Key) await this.deleteR2(old.r2Key);
			}
			await this.ctx.storage.delete(toDelete);
		}
		return full;
	}

	private async sendHistoryTo(ws: WebSocket): Promise<void> {
		const map = await this.ctx.storage.list<TunnelHistoryItem>({ prefix: "msg:" });
		const items = [...map.values()];
		ws.send(JSON.stringify({ type: "history", items }));
	}

	private async wipeRoom(): Promise<void> {
		const map = await this.ctx.storage.list<TunnelHistoryItem>({ prefix: "msg:" });
		for (const item of map.values()) {
			if (item.r2Key) await this.deleteR2(item.r2Key);
		}
		await this.ctx.storage.deleteAll();
		this.configLoaded = false;
		this.passwordHash = null;
		this.passwordSalt = null;
	}

	private async deleteR2(key: string): Promise<void> {
		try {
			await deleteS3Object(this.env, bucketName(this.env), key);
		} catch (err) {
			console.error("[tunnel] failed to delete R2 object", { key, err: String(err) });
		}
	}

	// ── File messages (≤1MB inline via R2; DO storage keeps a pointer) ────

	private async handleFile(
		ws: WebSocket,
		attachment: PeerAttachment,
		msg: { type: "file"; filename: string; contentType: string; sizeBytes: number; dataBase64: string },
	): Promise<void> {
		// Reject oversized payloads before paying for base64 decode — check
		// both the claimed size and the actual wire size (base64 inflates by
		// ~4/3, so this catches a lying/mismatched sizeBytes too).
		if (msg.sizeBytes > INLINE_MAX_BYTES || msg.dataBase64.length > INLINE_MAX_BYTES * 1.4) {
			ws.send(JSON.stringify({ type: "error", message: "File too large for the tunnel — use a regular share instead." }));
			return;
		}

		const bytes = base64ToBytes(msg.dataBase64);
		if (bytes.byteLength > INLINE_MAX_BYTES) {
			ws.send(JSON.stringify({ type: "error", message: "File too large for the tunnel — use a regular share instead." }));
			return;
		}
		const key = `tunnels/${this.tunnelCode()}/${Date.now()}-${sanitizeForKey(msg.filename)}`;

		await putS3Object(this.env, bucketName(this.env), key, bytes, msg.contentType);

		const item = await this.appendHistory({
			kind: "file",
			from: attachment.displayName,
			fromId: attachment.id,
			filename: msg.filename,
			sizeBytes: msg.sizeBytes,
			contentType: msg.contentType,
			r2Key: key,
		});

		this.broadcast({
			type: "file",
			from: attachment.displayName,
			id: attachment.id,
			filename: msg.filename,
			sizeBytes: msg.sizeBytes,
			contentType: msg.contentType,
			url: `/api/tunnel/${this.tunnelCode()}/file/${item.seq}`,
			seq: item.seq,
			createdAt: item.createdAt,
		});
	}

	private tunnelCode(): string {
		return this.ctx.id.name ?? this.ctx.id.toString();
	}

	// ── Broadcast helpers ───────────────────────────────────────────────

	private broadcast(payload: unknown, exclude?: WebSocket): void {
		const data = JSON.stringify(payload);
		for (const ws of this.ctx.getWebSockets()) {
			if (ws === exclude) continue;
			try {
				ws.send(data);
			} catch {
				// Peer socket is dead; webSocketClose/Error will clean it up.
			}
		}
	}

	private broadcastRoster(): void {
		const roster = this.ctx.getWebSockets().map((ws) => {
			const a = ws.deserializeAttachment() as PeerAttachment | null;
			return { id: a?.id ?? crypto.randomUUID(), displayName: a?.displayName ?? "anon" };
		});
		this.broadcast({ type: "roster", members: roster, max: MAX_PEERS });
	}

	/** Read-through for the file-download route: fetches one stored message's R2 key. */
	async getFileKey(seq: number): Promise<{ r2Key: string; filename: string; contentType: string } | null> {
		const item = await this.ctx.storage.get<TunnelHistoryItem>(`msg:${String(seq).padStart(10, "0")}`);
		if (!item || item.kind !== "file" || !item.r2Key) return null;
		return { r2Key: item.r2Key, filename: item.filename ?? "file", contentType: item.contentType ?? "application/octet-stream" };
	}
}

function base64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

function sanitizeForKey(name: string): string {
	return name.replace(/[^\w.\-]/g, "_").slice(0, 100) || "file";
}
