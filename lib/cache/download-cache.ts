import { GetObjectCommand } from '@aws-sdk/client-s3';
import { createS3Client, bucketName } from '@/lib/s3/client';
import { presignGet } from '@/lib/s3/presign';

/**
 * Cache API helpers for the download path.
 *
 * Cloudflare's Cache API (caches.default) is available in every Worker,
 * with a per-object size cap of 512 MB (Free and Paid) and call-quota
 * counted against subrequests. We use it to *pre-warm* the share's bytes
 * the moment an upload completes, so that the very first GET on the share
 * hits the cache instead of having to fetch from S3.
 *
 * Failure to pre-warm is non-fatal — the download route falls back to S3.
 * Conversely, on a cache hit we skip the S3 round-trip entirely.
 *
 * Cache keys use a fixed internal URL (independent of the request origin)
 * so that the download handler, the complete handler and the cleanup
 * cron all agree on the same key without needing to thread the public
 * hostname through every layer.
 */

// The bundled @cloudflare/workers-types 2021-11-03 doesn't know about the
// `default` property CF later added to CacheStorage. We resolve the cache
// handle lazily inside each function so the module is safe to import
// outside Workers (SvelteKit's postbuild analyse step runs in Node, which
// has no global `caches`).
interface CacheStorageWithDefault extends CacheStorage {
	readonly default: Cache;
}

function getDefaultCache(): CacheStorageWithDefault['default'] {
	return (caches as unknown as CacheStorageWithDefault).default;
}

const CACHE_KEY_HOST = 'https://cf-share-internal';

export function downloadCacheKey(token: string): Request {
	return new Request(`${CACHE_KEY_HOST}/api/download/${token}`);
}

/**
 * Stream the freshly-uploaded object from S3 into caches.default so the
 * first GET hits the cache.
 *
 * Uses streaming end-to-end (S3 → Worker → Cache API → edge) so we don't
 * load the whole file into Worker memory. 50 MB takes ~1 s, 500 MB takes
 * ~10 s on a typical CF edge link — well inside Workers Paid CPU time,
 * but still under the 50 subrequests/request Free quota because the only
 * remote calls are 1× S3 GET + 1× cache.put().
 */
export async function prefetchDownloadToCache(
	env: CloudflareEnv,
	args: {
		token: string;
		bucket: string;
		key: string;
		filename: string;
		contentType: string;
		size: number;
		etag?: string | null;
	}
): Promise<{ ok: boolean; reason?: string }> {
	try {
		const client = createS3Client(env);
		const dlUrl = await presignGet({
			client,
			bucket: args.bucket,
			key: args.key,
			expiresIn: 60,
			filename: args.filename
		});

		const upstream = await fetch(dlUrl);
		if (!upstream.ok || !upstream.body) {
			return { ok: false, reason: `s3-status-${upstream.status}` };
		}

		const headers = new Headers();
		headers.set('Content-Type', args.contentType || 'application/octet-stream');
		headers.set('Content-Length', String(args.size));
		if (args.etag) headers.set('ETag', `"${args.etag}"`);
		headers.set(
			'Content-Disposition',
			`attachment; filename="${args.filename.replace(/["\\r\\n]/g, '')}"`
		);
		headers.set('Cache-Control', 'public, max-age=2592000, stale-while-revalidate=2592000');
		headers.set('X-Robots-Tag', 'noindex, nofollow');

		const cachedResponse = new Response(upstream.body, {
			status: 200,
			headers
		});

		await getDefaultCache().put(downloadCacheKey(args.token), cachedResponse);
		return { ok: true };
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		console.warn('[prefetch] failed; first download will fall back to S3', {
			token: args.token,
			key: args.key,
			reason
		});
		return { ok: false, reason };
	}
}

/**
 * Look up a previously-cached download response.
 * Returns null on miss; the caller should fall back to S3.
 */
export async function matchDownloadCache(token: string): Promise<Response | null> {
	try {
		const hit = await getDefaultCache().match(downloadCacheKey(token));
		return hit ?? null;
	} catch (err) {
		console.warn('[download-cache] match failed; falling back to S3', {
			token,
			err: err instanceof Error ? err.message : String(err)
		});
		return null;
	}
}

/**
 * Remove a cached download entry — call from cleanup when a share expires
 * or is deleted out of band.
 */
export async function deleteDownloadCache(token: string): Promise<void> {
	try {
		await getDefaultCache().delete(downloadCacheKey(token));
	} catch (err) {
		console.warn('[download-cache] delete failed', {
			token,
			err: err instanceof Error ? err.message : String(err)
		});
	}
}

// Re-export for callers that already import the S3 client helpers.
export { bucketName };
