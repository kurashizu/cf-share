import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { RequestHandler } from '@sveltejs/kit';
import { createS3Client } from '@/lib/s3/client';
import { canProxyFile, proxyMaxFileSize } from '@/lib/config/proxy';
import { getShare, recordDownload } from '@/lib/share/store';
import { checkRateLimit } from '@/lib/rate-limit/check';
import { getClientIp } from '@/lib/util/ip';
import { audit } from '@/lib/util/audit';
import { contentDisposition } from '@/lib/util/content-disposition';
import { isValidToken } from '@/lib/share/token';

function errorResponse(message: string, status: number): Response {
	return new Response(JSON.stringify({ error: message }), {
		status,
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'private, no-store',
			'X-Robots-Tag': 'noindex, nofollow'
		}
	});
}

/**
 * GET /p/:token — stream an eligible, unprotected small file through Worker.
 *
 * This endpoint is intentionally limited by PROXY_MAX_FILE_SIZE (2 MiB by
 * default). It does not accept passwords or Range requests: protected shares
 * must use the normal authenticated S3 redirect flow.
 */
export const GET: RequestHandler = async ({
	request,
	platform,
	params,
	getClientAddress
}) => {
	const env = platform!.env;
	const { token } = params as { token: string };
	const ip = getClientIp(request, getClientAddress());

	try {
		const rl = await checkRateLimit(env, 'DOWNLOAD_LIMIT', ip);
		if (!rl.success) {
			await audit(env, {
				ip,
				action: 'download',
				shareToken: token,
				status: 429,
				detail: { reason: 'rate-limit', proxy: true }
			});
			return errorResponse('Too Many Requests', 429);
		}

		if (!isValidToken(token)) return errorResponse('Not found', 404);

		const share = await getShare(env, token);
		if (!share) {
			await audit(env, {
				ip,
				action: 'download',
				shareToken: token,
				status: 404,
				detail: { reason: 'missing-or-expired', proxy: true }
			});
			return errorResponse('Not found', 404);
		}

		if (!canProxyFile(env, share.size_bytes, !!share.password_hash)) {
			await audit(env, {
				ip,
				action: 'download',
				shareToken: token,
				status: 404,
				detail: {
					reason: share.password_hash ? 'password-protected' : 'file-too-large',
					proxy: true,
					proxyMaxBytes: proxyMaxFileSize(env),
					size: share.size_bytes
				}
			});
			return errorResponse('Not found', 404);
		}

		await recordDownload(env, token);

		const client = createS3Client(env);
		const output = await client.send(
			new GetObjectCommand({
				Bucket: share.bucket,
				Key: share.s3_key
			})
		);

		if (!output.Body) {
			return errorResponse('File unavailable', 502);
		}

		const headers = new Headers({
			'Cache-Control': 'private, no-store',
			'X-Robots-Tag': 'noindex, nofollow',
			'Content-Disposition': contentDisposition(share.filename),
			'Content-Type': output.ContentType || share.content_type
		});

		if (output.ContentLength !== undefined) {
			headers.set('Content-Length', String(output.ContentLength));
		}
		if (output.ETag) headers.set('ETag', output.ETag);
		if (output.LastModified) headers.set('Last-Modified', output.LastModified.toUTCString());

		await audit(env, {
			ip,
			action: 'download',
			shareToken: token,
			status: 200,
			detail: {
				proxy: true,
				userAgent: request.headers.get('user-agent')?.slice(0, 200) ?? null
			}
		});

		return new Response(output.Body.transformToWebStream(), { status: 200, headers });
	} catch (err) {
		const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata
			?.httpStatusCode;
		if (status === 404) return errorResponse('Not found', 404);

		console.error('[proxy] unexpected error', {
			token,
			err: err instanceof Error ? err.message : String(err)
		});
		return errorResponse('File unavailable', 502);
	}
};
