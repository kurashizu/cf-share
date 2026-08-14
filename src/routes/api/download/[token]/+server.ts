import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { createS3Client } from '@/lib/s3/client';
import { presignGet } from '@/lib/s3/presign';
import { getShare, recordDownload } from '@/lib/share/store';
import { verifyPassword } from '@/lib/share/password';
import { checkRateLimit } from '@/lib/rate-limit/check';
import { getClientIp } from '@/lib/util/ip';
import { audit } from '@/lib/util/audit';
import { contentDisposition } from '@/lib/util/content-disposition';
import { isValidToken } from '@/lib/share/token';

/**
 * GET /api/download/:token — bounded native streaming proxy.
 *
 * The whole handler runs inside the Cloudflare Worker compiled by
 * adapter-cloudflare. The object is proxied as sequential 8 MiB S3 Range GETs;
 * the Worker never buffers or caches the file. A downstream disconnect aborts
 * the current chunk and no later chunk is requested.
 * Byte-range requests are validated and forwarded through the same bounded
 * proxy.
 *
 *   ?info=1     → return share metadata as JSON (includes has_password).
 *   default     → stream the file bytes from S3 through the Worker (if no password).
 *   ?password=  → verify password and stream (if password-protected).
 *
 * POST /api/download/:token — password verification.
 *   Body: { password: string }. Returns 200 { verified, downloadUrl } on
 *   success, or 401 on wrong password.
 */

function downloadJson(
	data: unknown,
	status = 200,
	extraHeaders?: Record<string, string>
): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			'Content-Type': 'application/json',
			'X-Robots-Tag': 'noindex, nofollow',
			...extraHeaders
		}
	});
}

const S3_PROXY_CHUNK_BYTES = 8 * 1024 * 1024;
const DOWNSTREAM_IDLE_TIMEOUT_MS = 15_000;

interface ByteRange {
	start: number;
	end: number;
}

/** Parse one RFC 9110 byte range. Multi-range requests are rejected. */
function parseByteRange(header: string | null, size: number): ByteRange | null {
	if (!header) return { start: 0, end: size - 1 };
	const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!match) return null;

	const startText = match[1];
	const endText = match[2];
	if (!startText && !endText) return null;

	if (!startText) {
		const suffix = Number(endText);
		if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
		const length = Math.min(suffix, S3_PROXY_CHUNK_BYTES);
		return { start: Math.max(0, size - length), end: size - 1 };
	}

	const start = Number(startText);
	if (!Number.isSafeInteger(start) || start < 0 || start >= size) return null;
	const requestedEnd = endText ? Number(endText) : size - 1;
	if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return null;
	return {
		start,
		end: Math.min(requestedEnd, size - 1, start + S3_PROXY_CHUNK_BYTES - 1)
	};
}

/**
 * Proxy an object as sequential bounded S3 Range GETs.
 *
 * A bounded upstream request is intentional: if the downstream disappears
 * without propagating cancellation through the Worker runtime, at most the
 * current 8 MiB S3 request can continue. The next chunk is only requested
 * after the downstream asks for more data.
 */
function createChunkedS3Body(args: {
	dlUrl: string;
	range: ByteRange;
	baseHeaders: Headers;
	abort: AbortController;
}): ReadableStream<Uint8Array> {
	let offset = args.range.start;
	let currentEnd = -1;
	let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
	let idleTimer: ReturnType<typeof setTimeout> | null = null;
	let closed = false;

	const clearIdleTimer = () => {
		if (idleTimer !== null) clearTimeout(idleTimer);
		idleTimer = null;
	};

	const armIdleTimer = () => {
		clearIdleTimer();
		idleTimer = setTimeout(() => {
			closed = true;
			args.abort.abort(new Error('downstream-idle-timeout'));
			void reader?.cancel('downstream-idle-timeout');
		}, DOWNSTREAM_IDLE_TIMEOUT_MS);
	};

	return new ReadableStream<Uint8Array>({
		start() {
			armIdleTimer();
		},
		async pull(controller) {
			if (closed) return;
			armIdleTimer();

			try {
				while (offset <= args.range.end) {
					if (!reader) {
						currentEnd = Math.min(
							args.range.end,
							offset + S3_PROXY_CHUNK_BYTES - 1
						);
						const headers = new Headers(args.baseHeaders);
						headers.set('range', `bytes=${offset}-${currentEnd}`);
						const upstream = await fetch(args.dlUrl, {
							headers,
							signal: args.abort.signal
						});
						if (!upstream.ok || upstream.status !== 206 || !upstream.body) {
							throw new Error(`s3-chunk-status-${upstream.status}`);
						}
						reader = upstream.body.getReader();
					}

					const result = await reader.read();
					if (result.done) {
						reader.releaseLock();
						reader = null;
						offset = currentEnd + 1;
						continue;
					}
					controller.enqueue(result.value);
					armIdleTimer();
					return;
				}

				closed = true;
				clearIdleTimer();
				controller.close();
			} catch (err) {
				closed = true;
				clearIdleTimer();
				controller.error(err);
			}
		},
		async cancel(reason) {
			closed = true;
			clearIdleTimer();
			args.abort.abort(reason);
			try {
				await reader?.cancel(reason);
			} catch {
				// The current S3 chunk may already be closed.
			}
		}
	});
}

export const GET: RequestHandler = async ({
	request,
	platform,
	params,
	getClientAddress,
	url
}) => {
	const env = platform!.env;
	const { token } = params as { token: string };
	const ip = getClientIp(request, getClientAddress());

	try {
		// Rate-limit download lookups
		const rl = await checkRateLimit(env, 'DOWNLOAD_LOOKUP_LIMIT', ip);
		if (!rl.success) {
			await audit(env, {
				ip,
				action: 'download',
				shareToken: token,
				status: 429,
				detail: { reason: 'rate-limit' }
			});
			return downloadJson({ error: 'Too Many Requests' }, 429);
		}

		if (!isValidToken(token)) {
			return downloadJson(
				{ error: 'Not found' },
				404,
				{ 'Cache-Control': 'no-store' }
			);
		}

		const share = await getShare(env, token);
		if (!share) {
			await audit(env, {
				ip,
				action: 'download',
				shareToken: token,
				status: 404,
				detail: { reason: 'missing-or-expired' }
			});
			return downloadJson(
				{ error: 'Not found' },
				404,
				{ 'Cache-Control': 'no-store' }
			);
		}

		const hasPassword = !!share.password_hash;

		if (url.searchParams.get('info') === '1') {
			return downloadJson(
				{
					filename: share.filename,
					size_bytes: share.size_bytes,
					content_type: share.content_type,
					expires_at: share.expires_at,
					download_count: share.download_count,
					has_password: hasPassword
				},
				200,
				{ 'Cache-Control': 'no-store' }
			);
		}

		// ── Password verification (query param) ──
		const providedPassword = url.searchParams.get('password') ?? '';
		if (hasPassword) {
			if (
				!providedPassword ||
				!(await verifyPassword(
					providedPassword,
					share.password_salt!,
					share.password_hash!
				))
			) {
				await audit(env, {
					ip,
					action: 'download',
					shareToken: token,
					status: 401,
					detail: {
						reason:
							hasPassword && !providedPassword
								? 'password-required'
								: 'wrong-password'
					}
				});
				return downloadJson(
					{ error: 'Password required', password_protected: true },
					401,
					{ 'Cache-Control': 'no-store' }
				);
			}
		}

		const requestedRange = request.headers.get('range');
		const byteRange = parseByteRange(requestedRange, Number(share.size_bytes));
		if (!byteRange) {
			return new Response(null, {
				status: 416,
				headers: {
					'Content-Range': `bytes */${share.size_bytes}`,
					'Accept-Ranges': 'bytes',
					'Cache-Control': 'private, no-store'
				}
			});
		}

		await recordDownload(env, token);

		const client = createS3Client(env);
		const dlUrl = await presignGet({
			client,
			bucket: share.bucket,
			key: share.s3_key,
			expiresIn: Number(env.DOWNLOAD_URL_TTL),
			filename: share.filename
		});

		const upstreamAbort = new AbortController();
		const abortFromClient = () => upstreamAbort.abort(request.signal.reason);
		if (request.signal.aborted) {
			abortFromClient();
		} else {
			request.signal.addEventListener('abort', abortFromClient, { once: true });
		}

		const responseLength = byteRange.end - byteRange.start + 1;
		const responseHeaders = new Headers({
			'Content-Type': share.content_type || 'application/octet-stream',
			'Content-Length': String(responseLength),
			'Accept-Ranges': 'bytes',
			'Content-Disposition': contentDisposition(share.filename),
			'Cache-Control': 'private, no-store'
		});
		if (requestedRange) {
			responseHeaders.set(
				'Content-Range',
				`bytes ${byteRange.start}-${byteRange.end}/${share.size_bytes}`
			);
		}

		await audit(env, {
			ip,
			action: 'download',
			shareToken: token,
			status: requestedRange ? 206 : 200,
			detail: {
				...(hasPassword ? { password_protected: true } : {}),
				proxy: true,
				native: true,
				range: requestedRange,
				proxyRange: `bytes=${byteRange.start}-${byteRange.end}`,
				chunkBytes: S3_PROXY_CHUNK_BYTES,
				userAgent: request.headers.get('user-agent')?.slice(0, 200) ?? null
			}
		});

		const responseBody = createChunkedS3Body({
			dlUrl,
			range: byteRange,
			baseHeaders: new Headers(),
			abort: upstreamAbort
		});
		return new Response(responseBody, {
			status: requestedRange ? 206 : 200,
			headers: responseHeaders
		});
	} catch (err) {
		console.error('[download] unexpected error', {
			token,
			err: err instanceof Error ? err.message : String(err)
		});
		return downloadJson({ error: 'Internal Server Error' }, 500);
	}
};

export const POST: RequestHandler = async ({
	request,
	platform,
	params,
	getClientAddress
}) => {
	const env = platform!.env;
	const { token } = params as { token: string };
	const ip = getClientIp(request, getClientAddress());

	const rl = await checkRateLimit(env, 'DOWNLOAD_LOOKUP_LIMIT', ip);
	if (!rl.success) {
		return json({ error: 'Too Many Requests' }, { status: 429 });
	}

	if (!isValidToken(token)) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	const share = await getShare(env, token);
	if (!share) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	let body: { password?: unknown };
	try {
		body = (await request.json()) as { password?: unknown };
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const password = typeof body.password === 'string' ? body.password : '';

	if (!share.password_hash) {
		// No password set — just return the download URL directly
		const client = createS3Client(env);
		const dlUrl = await presignGet({
			client,
			bucket: share.bucket,
			key: share.s3_key,
			expiresIn: Number(env.DOWNLOAD_URL_TTL),
			filename: share.filename
		});
		return json({ verified: true, downloadUrl: dlUrl });
	}

	if (
		!password ||
		!(await verifyPassword(
			password,
			share.password_salt!,
			share.password_hash!
		))
	) {
		await audit(env, {
			ip,
			action: 'download',
			shareToken: token,
			status: 401,
			detail: { reason: 'wrong-password' }
		});
		return json({ error: 'Invalid password' }, { status: 401 });
	}

	await recordDownload(env, token);

	const client = createS3Client(env);
	const dlUrl = await presignGet({
		client,
		bucket: share.bucket,
		key: share.s3_key,
		expiresIn: Number(env.DOWNLOAD_URL_TTL),
		filename: share.filename
	});

	await audit(env, {
		ip,
		action: 'download',
		shareToken: token,
		status: 200,
		detail: { password_protected: true }
	});

	return json({ verified: true, downloadUrl: dlUrl });
};