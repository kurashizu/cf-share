/**
 * Minimal single-PUT upload path for tunnel messages that exceed the
 * inline WebSocket size cap. No multipart, no resume — tunnel fallback
 * items are always ≤ the site's normal anon max, so a single PUT covers it.
 *
 * Mirrors the init → PUT → complete sequence in Uploader.svelte, trimmed to
 * exactly what's needed here (no progress UI, no persisted-resume state).
 */

interface SingleInitResponse {
	mode: 'single';
	uploadId: string;
	key: string;
	uploadSig: string;
	url: string;
	headers: Record<string, string>;
}

/** Files older than this many seconds after upload never expire early — pick a short, generous TTL for tunnel drops. */
const TUNNEL_FALLBACK_TTL_SECONDS = 3600;

export interface TunnelFallbackResult {
	shareToken: string;
	shareUrl: string;
	filename: string;
	sizeBytes: number;
}

/** Uploads `file` via the normal share pipeline and returns its share pointer. */
export async function uploadAsFallbackShare(file: File): Promise<TunnelFallbackResult> {
	const initResp = await fetch('/api/upload/init', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			filename: file.name,
			size: file.size,
			contentType: file.type || 'application/octet-stream',
			ttl: TUNNEL_FALLBACK_TTL_SECONDS
		})
	});
	if (!initResp.ok) {
		throw new Error(`init ${initResp.status}: ${await initResp.text()}`);
	}
	const init = (await initResp.json()) as SingleInitResponse;

	const putResp = await fetch(init.url, {
		method: 'PUT',
		headers: init.headers,
		body: file
	});
	if (!putResp.ok) {
		throw new Error(`PUT ${putResp.status}`);
	}
	const etag = (putResp.headers.get('etag') || '').replace(/"/g, '');

	const completeResp = await fetch('/api/upload/complete', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			uploadId: init.uploadId,
			key: init.key,
			uploadSig: init.uploadSig,
			etag,
			filename: file.name,
			size: file.size,
			contentType: file.type || 'application/octet-stream',
			ttl: TUNNEL_FALLBACK_TTL_SECONDS
		})
	});
	if (!completeResp.ok) {
		throw new Error(`complete ${completeResp.status}: ${await completeResp.text()}`);
	}
	const data = (await completeResp.json()) as { shareToken: string; shareUrl: string };

	return {
		shareToken: data.shareToken,
		shareUrl: data.shareUrl,
		filename: file.name,
		sizeBytes: file.size
	};
}
