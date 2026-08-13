import { GetObjectCommand } from '@aws-sdk/client-s3';
import { createS3Client, bucketName } from '@/lib/s3/client';
import { presignGet } from '@/lib/s3/presign';
import { audit } from '@/lib/util/audit';

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
 * Background-fire-and-forget: the upload-complete handler should NOT
 * `await` this promise, but should pass it to `ctx.waitUntil()` so the
 * Worker stays alive long enough to fully buffer the body into the cache.
 *
 * Why: `caches.default.put()` writes a streaming Response by reading the
 * body in the background. If the Worker returns its HTTP response and
 * exits before that read completes, the cache write is cancelled mid-flight
 * — large files (e.g. 300 MB+) silently never land in the cache. With
 * waitUntil, the Worker holds the lifecycle open until the promise
 * resolves (or rejects).
 *
 * Failure is logged both as a console warning and an audit entry so we
 * can distinguish "prefetch failed" from "prefetch succeeded but cache
 * was evicted" in production telemetry.
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
		ip?: string | null;
	}
): Promise<{ ok: boolean; reason?: string }> {
	const startedAt = Date.now();

	// Skip prefetch for files that won't fit inside waitUntil's 30 s budget.
	// Cloudflare terminates waitUntil work after 30 s on every plan, so
	// prefetching a 300 MB file (which takes ~60 s at our 5 MB/s S3 link)
	// gets cancelled mid-write and silently never lands in the cache. Cache
	// API itself allows up to 512 MB per object; the bottleneck is wall time,
	// not storage. 150 MB leaves ~10 s headroom over the observed 19.6 s for
	// a 100 MB file.
	const PREFETCH_MAX_BYTES = 150 * 1024 * 1024;
	if (args.size > PREFETCH_MAX_BYTES) {
		try {
			await audit(env, {
				ip: args.ip ?? '0.0.0.0',
				action: 'complete',
				shareToken: args.token,
				status: 200,
				detail: {
					reason: 'prefetch-skipped',
					size: args.size,
					reason2: 'waitUntil-budget'
				}
			});
		} catch {}
		return { ok: false, reason: 'size-over-budget' };
	}

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
			throw new Error(`s3-status-${upstream.status}`);
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
		// Record success audit so we can confirm the prefetch actually landed.
		// Without this we can't distinguish "prefetch failed" from "prefetch
		// silently evicted" in production telemetry.
		const elapsedMs = Date.now() - startedAt;
		try {
			await audit(env, {
				ip: args.ip ?? '0.0.0.0',
				action: 'complete',
				shareToken: args.token,
				status: 200,
				detail: {
					reason: 'prefetch-success',
					size: args.size,
					elapsedMs
				}
			});
		} catch (auditErr) {
			console.warn('[prefetch] success-audit write failed', {
				token: args.token,
				err: String(auditErr)
			});
		}
		return { ok: true };
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		console.warn('[prefetch] failed; first download will fall back to S3', {
			token: args.token,
			key: args.key,
			size: args.size,
			reason
		});
		try {
			await audit(env, {
				ip: args.ip ?? '0.0.0.0',
				action: 'complete',
				shareToken: args.token,
				status: 200,
				detail: {
					reason: 'prefetch-failed',
					size: args.size,
					prefetchReason: reason
				}
			});
		} catch (auditErr) {
			console.warn('[prefetch] audit write also failed', {
				token: args.token,
				err: String(auditErr)
			});
		}
		return { ok: false, reason };
	}
}

/**
 * Look up a previously-cached download response.
 * Returns null on miss; the caller should fall back to S3.
 */
export async function matchDownloadCache(token: string): Promise<Response | null> {
	try {
		const cache = getDefaultCache();
		const key = downloadCacheKey(token);
		const hit = await cache.match(key);
		console.log('[cache-debug] match', {
			token,
			keyUrl: key.url,
			hit: !!hit,
			hitStatus: hit?.status,
			hitCC: hit?.headers.get('Cache-Control')
		});
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
