/**
 * Client-side WebSocket wrapper for a clipboard tunnel room.
 *
 * Heartbeat is purely for keeping the connection alive through idle-timeout
 * middleboxes and letting the DO notice a half-dead socket — it's never
 * persisted or counted as room history (see lib/tunnel/room.ts).
 */

export type IncomingMessage =
	| { type: 'welcome'; id: string }
	| { type: 'history'; items: HistoryItem[] }
	| { type: 'text'; from: string; id: string; body: string; seq: number; createdAt: number }
	| {
			type: 'file';
			from: string;
			id: string;
			filename: string;
			sizeBytes: number;
			contentType: string;
			url: string;
			seq: number;
			createdAt: number;
	  }
	| {
			type: 'share-link';
			from: string;
			id: string;
			filename: string;
			sizeBytes: number;
			shareUrl: string;
			seq: number;
			createdAt: number;
	  }
	| { type: 'presence'; event: 'joined' | 'left'; displayName: string; id: string }
	| { type: 'roster'; members: RosterMember[]; max: number }
	| { type: 'error'; message: string }
	| { type: 'pong' };

export interface RosterMember {
	id: string;
	displayName: string;
}

export interface HistoryItem {
	seq: number;
	kind: 'text' | 'file' | 'share-link' | 'presence';
	from: string;
	fromId: string;
	createdAt: number;
	body?: string;
	filename?: string;
	sizeBytes?: number;
	contentType?: string;
	shareUrl?: string;
	presenceEvent?: 'joined' | 'left';
}

const HEARTBEAT_MS = 25_000;
export const TUNNEL_INLINE_MAX_BYTES = 1024 * 1024;

export class TunnelSocket {
	private ws: WebSocket | null = null;
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	private closedByUser = false;

	constructor(
		private code: string,
		private displayName: string,
		private password: string | undefined,
		private onMessage: (msg: IncomingMessage) => void,
		private onClose: (reason: { code: number; expected: boolean }) => void
	) {}

	/** Resolves true once the socket is open, or false if it closes/errors first (bad password, full room, etc). */
	connect(timeoutMs = 4000): Promise<boolean> {
		this.closedByUser = false;
		const url = new URL(`/api/tunnel/${this.code}/ws`, location.origin);
		url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
		url.searchParams.set('name', this.displayName);
		if (this.password) url.searchParams.set('password', this.password);

		const ws = new WebSocket(url);
		this.ws = ws;

		ws.addEventListener('message', (e) => {
			try {
				this.onMessage(JSON.parse(e.data) as IncomingMessage);
			} catch {
				// ignore malformed frame
			}
		});
		ws.addEventListener('close', (e) => {
			this.stopHeartbeat();
			this.onClose({ code: e.code, expected: this.closedByUser });
		});

		return new Promise<boolean>((resolve) => {
			const onOpen = () => {
				this.startHeartbeat();
				resolve(true);
			};
			const onFail = () => resolve(false);
			ws.addEventListener('open', onOpen, { once: true });
			ws.addEventListener('close', onFail, { once: true });
			setTimeout(() => resolve(ws.readyState === WebSocket.OPEN), timeoutMs);
		});
	}

	private startHeartbeat(): void {
		this.stopHeartbeat();
		this.heartbeatTimer = setInterval(() => {
			if (this.ws?.readyState === WebSocket.OPEN) {
				this.ws.send(JSON.stringify({ type: 'ping' }));
			}
		}, HEARTBEAT_MS);
	}

	private stopHeartbeat(): void {
		if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
		this.heartbeatTimer = null;
	}

	sendText(body: string): void {
		this.ws?.send(JSON.stringify({ type: 'text', body }));
	}

	async sendFile(file: File): Promise<{ ok: true } | { ok: false; reason: string }> {
		if (file.size > TUNNEL_INLINE_MAX_BYTES) {
			return { ok: false, reason: 'too-large' };
		}
		const buf = await file.arrayBuffer();
		const dataBase64 = bytesToBase64(new Uint8Array(buf));
		this.ws?.send(
			JSON.stringify({
				type: 'file',
				filename: file.name,
				contentType: file.type || 'application/octet-stream',
				sizeBytes: file.size,
				dataBase64
			})
		);
		return { ok: true };
	}

	sendShareLink(args: { filename: string; sizeBytes: number; shareUrl: string; shareToken: string }): void {
		this.ws?.send(JSON.stringify({ type: 'share-link', ...args }));
	}

	close(): void {
		this.closedByUser = true;
		this.stopHeartbeat();
		this.ws?.close();
		this.ws = null;
	}
}

function bytesToBase64(bytes: Uint8Array): string {
	let bin = '';
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
	return btoa(bin);
}
