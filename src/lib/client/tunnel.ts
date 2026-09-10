/** Matches lib/tunnel/room.ts MAX_INLINE_MESSAGE_BYTES. Content over this goes through uploadAsFallbackShare instead. */
export const TUNNEL_INLINE_MAX_BYTES = 2 * 1024 * 1024;

export interface TunnelMessage {
	seq: number;
	kind: 'text' | 'file' | 'share';
	body: string | null;
	shareToken: string | null;
	filename: string | null;
	sizeBytes: number;
	sender: 'a' | 'b';
	createdAt: number;
}

export type TunnelStatus = 'connecting' | 'open' | 'closed' | 'full' | 'expired' | 'error';

/** Thin wrapper around the tunnel WebSocket: connect, send, receive, reconnect-free (one shot per room visit). */
export class TunnelConnection {
	private ws: WebSocket | null = null;

	onMessage: (msg: TunnelMessage) => void = () => {};
	onStatus: (status: TunnelStatus) => void = () => {};

	connect(code: string): void {
		const proto = location.protocol === 'https:' ? 'wss' : 'ws';
		this.onStatus('connecting');
		const ws = new WebSocket(`${proto}://${location.host}/api/tunnel/${code}/ws`);
		this.ws = ws;

		ws.addEventListener('open', () => this.onStatus('open'));
		ws.addEventListener('message', (e) => {
			if (typeof e.data !== 'string') return;
			try {
				this.onMessage(JSON.parse(e.data) as TunnelMessage);
			} catch {
				// ignore malformed frame
			}
		});
		ws.addEventListener('close', (e) => {
			if (e.code === 4000) this.onStatus('expired');
			else if (e.code === 4001 || e.code === 409) this.onStatus('full');
			else this.onStatus('closed');
		});
		ws.addEventListener('error', () => this.onStatus('error'));
	}

	sendText(body: string): void {
		this.ws?.send(JSON.stringify({ kind: 'text', body }));
	}

	sendFile(body: string, filename: string): void {
		this.ws?.send(JSON.stringify({ kind: 'file', body, filename }));
	}

	sendShare(shareToken: string, filename: string, sizeBytes: number): void {
		this.ws?.send(JSON.stringify({ kind: 'share', shareToken, filename, sizeBytes }));
	}

	close(): void {
		this.ws?.close();
		this.ws = null;
	}
}
