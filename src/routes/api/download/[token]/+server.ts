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
 * GET /api/download/:token — native streaming download.
 *
 * The whole handler runs inside the Cloudflare Worker that adapter-cloudflare
 * compiles the server into. There is no node-server bridge, so
 * `new Response(upstream.body, …)` is a plain Workers streaming passthrough —
 * the truncation bug that plagued the OpenNext pipeline cannot occur.
 * Byte-range requests are forwarded to S3 and replayed verbatim.
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

function cancellableBody(
	body: ReadableStream<Uint8Array>,
	abort: AbortController
): ReadableStream<Uint8Array> {
	const reader = body.getReader();
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const result = await reader.read();
				if (result.done) {
					controller.close();
					reader.releaseLock();
					return;
				}
				controller.enqueue(result.value);
			} catch (err) {
				controller.error(err);
			}
		},
		async cancel(reason) {
			abort.abort(reason);
			try {
				await reader.cancel(reason);
			} catch {
				// The upstream may already be closed or aborted.
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
		await recordDownload(env, token);

		const client = createS3Client(env);
		const dlUrl = await presignGet({
			client,
			bucket: share.bucket,
			key: share.s3_key,
			expiresIn: Number(env.DOWNLOAD_URL_TTL),
			filename: share.filename
		});

		// Forward byte-range headers so paused/resuming downloads work.
		const upstreamHeaders = new Headers();
		for (const h of ['if-range', 'if-none-match', 'if-modified-since']) {
			const v = request.headers.get(h);
			if (v) upstreamHeaders.set(h, v);
		}
		if (requestedRange) {
			upstreamHeaders.set('range', requestedRange);
		}

		const upstreamAbort = new AbortController();
		const abortFromClient = () => upstreamAbort.abort(request.signal.reason);
		if (request.signal.aborted) {
			abortFromClient();
		} else {
			request.signal.addEventListener('abort', abortFromClient, { once: true });
		}

		const upstream = await fetch(dlUrl, {
			headers: upstreamHeaders,
			signal: upstreamAbort.signal
		});
		if (!upstream.ok && upstream.status !== 206 && upstream.status !== 304) {
			upstreamAbort.abort();
			console.error('[download] S3 proxy request failed', {
				token,
				status: upstream.status
			});
			return downloadJson(
				{ error: 'Download failed' },
				upstream.status >= 400 ? upstream.status : 502
			);
		}

		const responseHeaders = new Headers();
		for (const h of [
			'content-type',
			'content-length',
			'content-range',
			'accept-ranges',
			'etag',
			'last-modified'
		]) {
			const v = upstream.headers.get(h);
			if (v) responseHeaders.set(h, v);
		}
		responseHeaders.set('Cache-Control', 'private, no-store');
		responseHeaders.set('Content-Disposition', contentDisposition(share.filename));

		await audit(env, {
			ip,
			action: 'download',
			shareToken: token,
			status: upstream.status,
			detail: {
				...(hasPassword ? { password_protected: true } : {}),
				proxy: true,
				native: true,
				range: requestedRange,
				upstreamContentLength: upstream.headers.get('content-length'),
				upstreamContentRange: upstream.headers.get('content-range'),
				userAgent: request.headers.get('user-agent')?.slice(0, 200) ?? null
			}
		});

		// Native streaming passthrough — exactly one S3 GET per download request.
		// The request signal cancels the upstream fetch when the client disconnects;
		// cancellableBody also cancels the reader explicitly when the response body
		// is closed by the downstream runtime.
		const responseBody = upstream.body
			? cancellableBody(upstream.body, upstreamAbort)
			: null;
		return new Response(responseBody, {
			status: upstream.status,
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