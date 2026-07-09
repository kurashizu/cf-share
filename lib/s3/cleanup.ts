/// <reference path="../../cloudflare-env.d.ts" />

import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { createS3Client, bucketName } from "./client";

/**
 * Result of a single cleanup pass.
 */
export interface CleanupResult {
	examined: number;
	deleted: number;
	failed: number;
	s3Errors: number;
	quotaPrunedRows: number;
	durationMs: number;
}

/**
 * Delete an S3 object. Missing objects are NOT errors (idempotent).
 * Any other S3 failure is logged and counted but does not throw — we still
 * want to delete the D1 row so we don't retry forever.
 */
export async function deleteS3Object(
	env: CloudflareEnv,
	bucket: string,
	key: string,
): Promise<{ ok: boolean; missing: boolean }> {
	const client = createS3Client(env);
	try {
		await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
		return { ok: true, missing: false };
	} catch (err) {
		const code =
			(err as { name?: string; $metadata?: { httpStatusCode?: number } }).name ??
			(err as { Code?: string }).Code ??
			"";
		const status =
			(err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode ?? 0;
		// 404 → already gone
		if (code === "NoSuchKey" || code === "NotFound" || status === 404) {
			return { ok: true, missing: true };
		}
		console.error("[cleanup] S3 delete failed", { bucket, key, code, status, err: String(err) });
		return { ok: false, missing: false };
	}
}

/**
 * Delete a share row from D1 by token.
 */
export async function deleteShareRow(env: CloudflareEnv, token: string): Promise<void> {
	await env.DB.prepare(`DELETE FROM shares WHERE token = ?1`).bind(token).run();
}

/**
 * Find shares whose expires_at < now.
 * Returns up to `limit` rows. Caller is responsible for batching.
 */
export async function findExpiredShares(
	env: CloudflareEnv,
	now: number,
	limit: number,
): Promise<
	Array<{
		token: string;
		bucket: string;
		s3_key: string;
		size_bytes: number;
	}>
> {
	const r = await env.DB.prepare(
		`SELECT token, bucket, s3_key, size_bytes
		 FROM shares
		 WHERE expires_at < ?1
		 ORDER BY expires_at ASC
		 LIMIT ?2`,
	)
		.bind(now, limit)
		.all<{ token: string; bucket: string; s3_key: string; size_bytes: number }>();
	return r.results ?? [];
}

/**
 * Delete S3 objects for expired shares + remove the D1 rows.
 *
 * The cleanup job is idempotent: missing objects count as success,
 * so re-running after a partial failure does no harm.
 *
 * Stops early if `options.maxBatchMs` is exceeded so a single daily
 * run cannot starve Worker CPU. Remaining rows are picked up the
 * next day.
 */
export async function runExpiredShareCleanup(
	env: CloudflareEnv,
	options: { batchSize: number; maxBatchMs: number },
): Promise<{ examined: number; deleted: number; failed: number; s3Errors: number }> {
	const start = Date.now();
	const now = Date.now();
	const expired = await findExpiredShares(env, now, options.batchSize);

	let deleted = 0;
	let failed = 0;
	let s3Errors = 0;

	for (const share of expired) {
		if (Date.now() - start > options.maxBatchMs) {
			console.warn("[cleanup] time budget exhausted, will resume next run", {
				examined: expired.indexOf(share),
				total: expired.length,
			});
			break;
		}

		const s3 = await deleteS3Object(env, share.bucket, share.s3_key);
		if (!s3.ok) s3Errors++;

		try {
			await deleteShareRow(env, share.token);
			deleted++;
		} catch (err) {
			failed++;
			console.error("[cleanup] D1 delete failed", {
				token: share.token,
				err: String(err),
			});
		}
	}

	return { examined: expired.length, deleted, failed, s3Errors };
}

/**
 * Drop upload_quota rows whose `day` is older than `keepDays`.
 *
 * Cheap (D1 just deletes rows), but we still batch to avoid one giant statement.
 */
export async function pruneOldQuota(
	env: CloudflareEnv,
	keepDays: number,
): Promise<number> {
	const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000)
		.toISOString()
		.slice(0, 10); // YYYY-MM-DD
	const r = await env.DB.prepare(`DELETE FROM upload_quota WHERE day < ?1`)
		.bind(cutoff)
		.run();
	return (r.meta as { changes?: number } | undefined)?.changes ?? 0;
}

/**
 * One-shot cleanup combining the two jobs. Used by the cron handler
 * and by the manual `/api/cron/cleanup` HTTP endpoint.
 */
export async function runCleanup(env: CloudflareEnv): Promise<CleanupResult> {
	const start = Date.now();

	const [shares, quotaPrunedRows] = await Promise.all([
		runExpiredShareCleanup(env, {
			batchSize: Number(env.CLEANUP_BATCH_SIZE ?? 500),
			maxBatchMs: Number(env.CLEANUP_MAX_BATCH_MS ?? 25_000),
		}),
		pruneOldQuota(env, Number(env.CLEANUP_QUOTA_KEEP_DAYS ?? 30)),
	]);

	return {
		...shares,
		quotaPrunedRows,
		durationMs: Date.now() - start,
	};
}

// Re-export the bucket helper so call sites can `import { bucketName } from "@/lib/s3/cleanup"`.
export { bucketName };
