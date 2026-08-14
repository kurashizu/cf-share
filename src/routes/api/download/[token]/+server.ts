import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { createS3Client } from '@/lib/s3/client';
import { presignGet } from '@/lib/s3/presign';
import { getShare, recordDownload } from '@/lib/share/store';
import { verifyPassword } from '@/lib/share/password';
import { checkRateLimit } from '@/lib/rate-limit/check';
import { getClientIp } from '@/lib/util/ip';
import { audit } from '@/lib/util/audit';
import { isValidToken } from '@/lib/share/token';

/**
 * GET /api/download/:token — authenticated redirect to S3.
 *
 * The Worker performs the D1 lookup, password gate, rate-limit check, and
 * audit, then returns a short-lived 307 redirect to the presigned S3 URL.
 * File bytes never pass through the Worker, so closing the client connection
 * closes the S3 connection directly without a Worker-held upstream stream.
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

		await audit(env, {
			ip,
			action: 'download',
			shareToken: token,
			status: 307,
			detail: {
				...(hasPassword ? { password_protected: true } : {}),
				redirect: true,
				range: requestedRange,
				userAgent: request.headers.get('user-agent')?.slice(0, 200) ?? null
			}
		});

		return new Response(null, {
			status: 307,
			headers: {
			Location: dlUrl,
			'Cache-Control': 'private, no-store',
			'X-Robots-Tag': 'noindex, nofollow'
		}
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