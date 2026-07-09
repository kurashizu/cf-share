/// <reference path="../../cloudflare-env.d.ts" />

import { generateUniqueToken } from "./token";

export interface ShareRecord {
  token: string;
  bucket: string;
  prefix: string;
  s3_key: string;
  filename: string;
  size_bytes: number;
  content_type: string;
  expires_at: number;
  created_at: number;
  created_ip: string | null;
  user_agent: string | null;
  download_count: number;
  last_download_at: number | null;
  password_hash: string | null;
  password_salt: string | null;
}

/** Check whether a token already exists in the shares table. */
export async function tokenExists(
  env: CloudflareEnv,
  token: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS x FROM shares WHERE token = ?1 LIMIT 1`,
  )
    .bind(token)
    .first<{ x: number }>();
  return !!row;
}

/** Mint a unique share token and insert the share record atomically. */
export async function createShare(
  env: CloudflareEnv,
  args: {
    bucket: string;
    s3Key: string;
    filename: string;
    sizeBytes: number;
    contentType: string;
    expiresAt: number;
    ip: string;
    userAgent: string | null;
    passwordHash?: string | null;
    passwordSalt?: string | null;
  },
): Promise<{ token: string }> {
  const token = await generateUniqueToken((t) => tokenExists(env, t));

  // The "prefix" is the parent directory of the object, used by the cleanup
  // cron to enumerate per-share S3 objects (without needing ListBucket).
  const prefix = args.s3Key.includes("/")
    ? args.s3Key.slice(0, args.s3Key.lastIndexOf("/") + 1)
    : "";

  await env.DB.prepare(
    `INSERT INTO shares (
				token, bucket, prefix, s3_key, filename, size_bytes, content_type,
				expires_at, created_at, created_ip, user_agent,
				download_count, last_download_at,
				password_hash, password_salt
			) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 0, NULL, ?12, ?13)`,
  )
    .bind(
      token,
      args.bucket,
      prefix,
      args.s3Key,
      args.filename,
      args.sizeBytes,
      args.contentType,
      args.expiresAt,
      Date.now(),
      args.ip,
      args.userAgent,
      args.passwordHash ?? null,
      args.passwordSalt ?? null,
    )
    .run();

  return { token };
}

/** Look up a share by token. Returns null if missing or expired. */
export async function getShare(
  env: CloudflareEnv,
  token: string,
): Promise<ShareRecord | null> {
  const row = await env.DB.prepare(
    `SELECT token, bucket, prefix, s3_key, filename, size_bytes, content_type,
			        expires_at, created_at, created_ip, user_agent,
			        download_count, last_download_at,
			        password_hash, password_salt
			 FROM shares
			 WHERE token = ?1
			 LIMIT 1`,
  )
    .bind(token)
    .first<ShareRecord>();
  if (!row) return null;
  if (row.expires_at < Date.now()) return null;
  return row;
}

/** Increment download counters; returns the new count (or null if row was deleted). */
export async function recordDownload(
  env: CloudflareEnv,
  token: string,
): Promise<number | null> {
  const r = await env.DB.prepare(
    `UPDATE shares
		 SET download_count = download_count + 1,
		     last_download_at = ?2
		 WHERE token = ?1
		 RETURNING download_count`,
  )
    .bind(token, Date.now())
    .first<{ download_count: number }>();
  return r?.download_count ?? null;
}

/** Atomically increment an IP's daily upload quota. Returns the new totals. */
export async function incrementQuota(
  env: CloudflareEnv,
  args: {
    ip: string;
    day: string;
    bytes: number;
  },
): Promise<{ totalBytes: number; count: number }> {
  // Upsert: insert 0,0 then add. D1 doesn't have ON CONFLICT … DO UPDATE
  // with RETURNING reliably, so we do read+write in two statements (good
  // enough at our QPS).
  await env.DB.prepare(
    `INSERT INTO upload_quota (ip, day, total_bytes, count)
		 VALUES (?1, ?2, 0, 0)
		 ON CONFLICT(ip, day) DO NOTHING`,
  )
    .bind(args.ip, args.day)
    .run();

  const r = await env.DB.prepare(
    `UPDATE upload_quota
		 SET total_bytes = total_bytes + ?3,
		     count       = count + 1
		 WHERE ip = ?1 AND day = ?2
		 RETURNING total_bytes, count`,
  )
    .bind(args.ip, args.day, args.bytes)
    .first<{ total_bytes: number; count: number }>();

  return {
    totalBytes: r?.total_bytes ?? 0,
    count: r?.count ?? 0,
  };
}

/** Read the current quota row for an IP+day (does not create one). */
export async function readQuota(
  env: CloudflareEnv,
  ip: string,
  day: string,
): Promise<{
  totalBytes: number;
  count: number;
} | null> {
  const r = await env.DB.prepare(
    `SELECT total_bytes, count FROM upload_quota WHERE ip = ?1 AND day = ?2 LIMIT 1`,
  )
    .bind(ip, day)
    .first<{ total_bytes: number; count: number }>();
  return r ? { totalBytes: r.total_bytes, count: r.count } : null;
}
