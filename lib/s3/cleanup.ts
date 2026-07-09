/// <reference path="../../cloudflare-env.d.ts" />

import {
  DeleteObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
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
  /** Orphaned in-progress multipart uploads aborted. */
  multipartAborted: number;
  /** Orphaned tmp-* objects (PUT but never completed) deleted from S3. */
  orphanObjectsDeleted: number;
  durationMs: number;
}

// ── S3 helpers ─────────────────────────────────────────────────────────────

/**
 * Delete an S3 object. Missing objects are NOT errors (idempotent).
 * Any other S3 failure is logged and counted but does not throw.
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
      (err as { name?: string; $metadata?: { httpStatusCode?: number } })
        .name ??
      (err as { Code?: string }).Code ??
      "";
    const status =
      (err as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode ?? 0;
    if (code === "NoSuchKey" || code === "NotFound" || status === 404) {
      return { ok: true, missing: true };
    }
    console.error("[cleanup] S3 delete failed", {
      bucket,
      key,
      code,
      status,
      err: String(err),
    });
    return { ok: false, missing: false };
  }
}

// ── D1 helpers ──────────────────────────────────────────────────────────────

/** Delete a share row from D1 by token. */
export async function deleteShareRow(
  env: CloudflareEnv,
  token: string,
): Promise<void> {
  await env.DB.prepare(`DELETE FROM shares WHERE token = ?1`).bind(token).run();
}

/** Check whether any active (non-expired) share uses a given s3_key prefix. */
async function activeShareHasKey(
  env: CloudflareEnv,
  s3Key: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS x FROM shares WHERE s3_key = ?1 AND expires_at > ?2 LIMIT 1`,
  )
    .bind(s3Key, Date.now())
    .first<{ x: number }>();
  return !!row;
}

/** Check whether any share (even expired) uses a given s3_key. */
async function anyShareHasKey(
  env: CloudflareEnv,
  s3Key: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS x FROM shares WHERE s3_key = ?1 LIMIT 1`,
  )
    .bind(s3Key)
    .first<{ x: number }>();
  return !!row;
}

// ── Expired share cleanup ───────────────────────────────────────────────────

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
    .all<{
      token: string;
      bucket: string;
      s3_key: string;
      size_bytes: number;
    }>();
  return r.results ?? [];
}

export async function runExpiredShareCleanup(
  env: CloudflareEnv,
  options: { batchSize: number; maxBatchMs: number },
): Promise<{
  examined: number;
  deleted: number;
  failed: number;
  s3Errors: number;
}> {
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

// ── Orphaned multipart upload cleanup ───────────────────────────────────────

/**
 * List all in-progress multipart uploads on S3 and abort ones older than
 * `maxAgeMs`. These are uploads where the user called init, maybe uploaded
 * some parts, then walked away — no D1 row was ever created (or it expired
 * without completing the multipart).
 */
export async function cleanupOrphanedMultipartUploads(
  env: CloudflareEnv,
  bucket: string,
  maxAgeMs: number,
  maxItems = 100,
): Promise<{ aborted: number; errors: number }> {
  const client = createS3Client(env);
  let aborted = 0;
  let errors = 0;

  try {
    const listResp = await client.send(
      new ListMultipartUploadsCommand({
        Bucket: bucket,
        MaxUploads: maxItems,
      }),
    );

    const uploads = listResp.Uploads ?? [];
    for (const u of uploads) {
      const initiated = u.Initiated?.getTime() ?? 0;
      const age = Date.now() - initiated;

      if (age > maxAgeMs) {
        const key = u.Key ?? "";
        const uploadId = u.UploadId ?? "";

        // Skip if an active share references this key (shouldn't happen,
        // but be safe).
        if (key && (await anyShareHasKey(env, key))) continue;

        try {
          await client.send(
            new AbortMultipartUploadCommand({
              Bucket: bucket,
              Key: key,
              UploadId: uploadId,
            }),
          );
          aborted++;
          console.log("[cleanup] aborted stale multipart upload", {
            key,
            uploadId,
            ageMinutes: Math.round(age / 60000),
          });
        } catch (err2) {
          errors++;
          console.error("[cleanup] failed to abort multipart upload", {
            key,
            uploadId,
            err: String(err2),
          });
        }
      }
    }
  } catch (err) {
    // ListMultipartUploads may fail if S3 doesn't support it or bucket policy
    // restricts it. Non-fatal.
    console.warn("[cleanup] ListMultipartUploads failed (non-fatal)", {
      err: String(err),
    });
  }

  return { aborted, errors };
}

// ── Orphaned tmp-* object cleanup ──────────────────────────────────────────

/**
 * List S3 objects whose key contains `tmp-` and delete any that have no
 * corresponding D1 share row. These are files that were PUT to the presigned
 * URL but the user never called `/api/upload/complete`.
 *
 * We limit the listing to `maxKeys` and `maxDelete` to stay within the cron
 * time budget.
 */
export async function cleanupOrphanedTempObjects(
  env: CloudflareEnv,
  bucket: string,
  prefix: string,
  maxKeys = 200,
): Promise<{ deleted: number; errors: number }> {
  const client = createS3Client(env);
  let deleted = 0;
  let errors = 0;

  try {
    // List all objects under the uploads prefix. We restrict with `tmp-` in
    // the prefix by scanning down to date-based directories — the tmp- token
    // is at the 4th path component, so we pass prefix = "uploads/" and
    // filter client-side.
    //
    // A more precise approach: list "uploads/" and check keys containing
    // "/tmp-". For a busy bucket this could return many keys, so we limit
    // to `maxKeys`.
    const listResp = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: maxKeys,
      }),
    );

    const objects = listResp.Contents ?? [];
    for (const obj of objects) {
      const key = obj.Key ?? "";
      if (!key.includes("/tmp-")) continue;

      // If no share (active or expired) references this key, it's orphaned.
      if (!(await anyShareHasKey(env, key))) {
        const result = await deleteS3Object(env, bucket, key);
        if (result.ok) deleted++;
        else errors++;
      }
    }
  } catch (err) {
    console.warn("[cleanup] ListObjectsV2 failed (non-fatal)", {
      err: String(err),
    });
  }

  return { deleted, errors };
}

// ── Quota pruning ───────────────────────────────────────────────────────────

export async function pruneOldQuota(
  env: CloudflareEnv,
  keepDays: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const r = await env.DB.prepare(`DELETE FROM upload_quota WHERE day < ?1`)
    .bind(cutoff)
    .run();
  return (r.meta as { changes?: number } | undefined)?.changes ?? 0;
}

// ── Combined runner ─────────────────────────────────────────────────────────

/**
 * One-shot cleanup combining expired shares, orphaned multipart uploads,
 * orphaned temp objects, and quota pruning. Runs from the 30-min cron.
 */
export async function runCleanup(env: CloudflareEnv): Promise<CleanupResult> {
  const start = Date.now();
  const bucket = bucketName(env);

  const [shares, multipartResult, orphanResult, quotaPrunedRows] =
    await Promise.all([
      runExpiredShareCleanup(env, {
        batchSize: Number(env.CLEANUP_BATCH_SIZE ?? 500),
        maxBatchMs: Number(env.CLEANUP_MAX_BATCH_MS ?? 25_000),
      }),
      cleanupOrphanedMultipartUploads(
        env,
        bucket,
        30 * 60 * 1000, // abort multipart uploads initiated >30 min ago
        100,
      ),
      cleanupOrphanedTempObjects(env, bucket, "uploads/", 200),
      pruneOldQuota(env, Number(env.CLEANUP_QUOTA_KEEP_DAYS ?? 30)),
    ]);

  return {
    ...shares,
    quotaPrunedRows,
    multipartAborted: multipartResult.aborted,
    orphanObjectsDeleted: orphanResult.deleted,
    durationMs: Date.now() - start,
  };
}

export { bucketName };
