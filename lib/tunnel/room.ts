/// <reference path="../../cloudflare-env.d.ts" />

import { normalizeToken } from "../share/token";
import {
	appendTunnelMessage,
	destroyTunnel,
	markTunnelJoined,
	tunnelIsLive,
	TUNNEL_JOIN_TIMEOUT_MS
} from "./store";

/** Hard cap on an inline tunnel message — matches the client-side fallback threshold. */
export const MAX_INLINE_MESSAGE_BYTES = 2 * 1024 * 1024;

interface InboundTextMessage {
	kind: 'text';
	body: string;
}

interface InboundFileMessage {
	kind: 'file';
	/** data: URL — base64-encoded, small enough to stay under the inline cap. */
	body: string;
	filename: string;
}

interface InboundShareMessage {
	kind: 'share';
	shareToken: string;
	filename: string;
	sizeBytes: number;
}

type InboundMessage = InboundTextMessage | InboundFileMessage | InboundShareMessage;

interface WsAttachment {
	role: 'a' | 'b';
	code: string;
}

/**
 * One TunnelRoom instance per tunnel code (`idFromName(code)`).
 * Holds up to two hibernatable WebSockets (peer 'a' and 'b') and relays
 * messages between them. Message history lives in D1 (tunnel_messages),
 * not in DO memory — hibernation can drop in-memory state at any time.
 */
export class TunnelRoom {
	state: DurableObjectState;
	env: CloudflareEnv;

	constructor(state: DurableObjectState, env: CloudflareEnv) {
		this.state = state;
		this.env = env;
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const code = normalizeToken(url.searchParams.get('code'));
		if (!code) {
			return new Response('invalid tunnel code', { status: 400 });
		}

		if (request.headers.get('Upgrade') !== 'websocket') {
			return new Response('expected websocket upgrade', { status: 426 });
		}

		if (!(await tunnelIsLive(this.env, code))) {
			return new Response('tunnel expired or not found', { status: 404 });
		}

		const sockets = this.state.getWebSockets();
		const takenRoles = new Set(sockets.map((s) => (s.deserializeAttachment() as WsAttachment).role));
		if (sockets.length >= 2) {
			return new Response('tunnel room is full', { status: 409 });
		}
		const role: WsAttachment['role'] = takenRoles.has('a') ? 'b' : 'a';

		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);

		this.state.acceptWebSocket(server);
		server.serializeAttachment({ role, code });

		if (role === 'a') {
			// Guard against an unjoined tunnel lingering forever.
			await this.state.storage.setAlarm(Date.now() + TUNNEL_JOIN_TIMEOUT_MS);
		} else {
			await markTunnelJoined(this.env, code);
		}

		return new Response(null, { status: 101, webSocket: client });
	}

	/** Fires TUNNEL_JOIN_TIMEOUT_MS after peer 'a' connects; no-ops if 'b' already joined. */
	async alarm(): Promise<void> {
		const sockets = this.state.getWebSockets();
		const joined = sockets.some((s) => (s.deserializeAttachment() as WsAttachment)?.role === 'b');
		if (joined) return;

		const code = sockets[0] ? this.codeFromWs(sockets[0]) : null;
		if (!code) return;

		if (!(await tunnelIsLive(this.env, code))) return;
		await destroyTunnel(this.env, code);
		for (const socket of sockets) {
			socket.close(4000, 'tunnel expired — no peer joined in time');
		}
	}

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		const code = this.codeFromWs(ws);
		if (!code) return;

		if (typeof message !== 'string') {
			ws.close(1003, 'binary frames not supported — send JSON with base64 body');
			return;
		}
		if (message.length > MAX_INLINE_MESSAGE_BYTES * 2) {
			// base64 inflates ~33%; generous upper bound before even parsing.
			ws.close(1009, 'message too large');
			return;
		}

		let parsed: InboundMessage;
		try {
			parsed = JSON.parse(message);
		} catch {
			return;
		}

		const { role } = ws.deserializeAttachment() as WsAttachment;

		if (parsed.kind === 'text') {
			const byteLength = new TextEncoder().encode(parsed.body).length;
			if (byteLength > MAX_INLINE_MESSAGE_BYTES) {
				ws.close(1009, 'message too large');
				return;
			}
			const saved = await appendTunnelMessage(this.env, code, {
				kind: 'text',
				body: parsed.body,
				shareToken: null,
				filename: null,
				sizeBytes: byteLength,
				sender: role
			});
			this.broadcastToPeers(ws, saved);
		} else if (parsed.kind === 'file') {
			if (typeof parsed.body !== 'string' || typeof parsed.filename !== 'string') {
				return;
			}
			const byteLength = new TextEncoder().encode(parsed.body).length;
			if (byteLength > MAX_INLINE_MESSAGE_BYTES * 2) {
				ws.close(1009, 'message too large');
				return;
			}
			const saved = await appendTunnelMessage(this.env, code, {
				kind: 'file',
				body: parsed.body,
				shareToken: null,
				filename: parsed.filename,
				sizeBytes: byteLength,
				sender: role
			});
			this.broadcastToPeers(ws, saved);
		} else if (parsed.kind === 'share') {
			if (
				typeof parsed.shareToken !== 'string' ||
				typeof parsed.filename !== 'string' ||
				typeof parsed.sizeBytes !== 'number'
			) {
				return;
			}
			const saved = await appendTunnelMessage(this.env, code, {
				kind: 'share',
				body: null,
				shareToken: parsed.shareToken,
				filename: parsed.filename,
				sizeBytes: parsed.sizeBytes,
				sender: role
			});
			this.broadcastToPeers(ws, saved);
		}
	}

	async webSocketClose(ws: WebSocket): Promise<void> {
		const tunnelCode = this.codeFromWs(ws);
		// getWebSockets() still includes `ws` itself at this point, so "empty
		// room" means the OTHER socket(s) are gone too.
		const remaining = this.state.getWebSockets().filter((s) => s !== ws);
		if (tunnelCode && remaining.length === 0) {
			await destroyTunnel(this.env, tunnelCode);
		}
	}

	async webSocketError(ws: WebSocket): Promise<void> {
		await this.webSocketClose(ws);
	}

	/** Relay a message to the other peer only (not an echo back to the sender). */
	private broadcastToPeers(
		sender: WebSocket,
		msg: { seq: number; kind: string; body: string | null; shareToken: string | null; filename: string | null; sizeBytes: number; sender: string; createdAt: number }
	): void {
		const payload = JSON.stringify(msg);
		for (const socket of this.state.getWebSockets()) {
			if (socket !== sender) socket.send(payload);
		}
	}

	private codeFromWs(ws: WebSocket): string | null {
		try {
			return (ws.deserializeAttachment() as WsAttachment).code ?? null;
		} catch {
			return null;
		}
	}
}
