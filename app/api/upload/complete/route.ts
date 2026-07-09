import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { createS3Client, bucketName } from "../../../../lib/s3/client";
import {
  completeMultipartUpload,
  type CompletedPart,
} from "../../../../lib/s3/multipart";
import { checkRateLimit } from "../../../../lib/rate-limit/check";
import { getClientIp, utcDayKey } from "../../../../lib/util/ip";
import { audit } from "../../../../lib/util/audit";
import {
  createShare,
  incrementQuota,
  readQuota,
} from "../../../../lib/share/store";
import { hashPassword, isValidPassword } from "../../../../lib/share/password";

export const runtime = "nodejs";

interface CompleteBody {
  mode?: unknown;
  uploadId?: unknown;
  s3UploadId?: unknown;
  key?: unknown;
  filename?: unknown;
  size?: unknown;
  contentType?: unknown;
  etag?: unknown;
  ttl?: unknown;
  password?: unknown;
  parts?: unknown;
}

interface CompleteResponse {
  shareToken: string;
  shareUrl: string;
  fullUrl: string;
  expiresAt: number;
}

/**
 * POST /api/upload/complete
 *
 * Finalizes an upload — supports two modes detected from body fields:
 *
 *   single (default):
 *     { uploadId, key, filename, size, contentType, etag, ttl, password? }
 *
 *   multipart:
 *     { mode:"multipart", uploadId, s3UploadId, key, filename, size,
 *       contentType, parts:[{partNumber,etag}], ttl, password? }
 */
export async function POST(request: Request): Promise<NextResponse> {
  const { env } = await getCloudflareContext();
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent")?.slice(0, 200) ?? null;

  // ── Rate limit ──
  const rl = await checkRateLimit(env, "UPLOAD_COMPLETE_LIMIT", ip);
  if (!rl.success) {
    await audit(env, {
      ip,
      action: "complete",
      status: 429,
      detail: { reason: "rate-limit" },
    });
    return NextResponse.json({ error: "Too Many Requests" }, { status: 429 });
  }

  // ── Parse body ──
  let body: CompleteBody;
  try {
    body = (await request.json()) as CompleteBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const uploadId =
    typeof body.uploadId === "string" ? body.uploadId.trim() : "";
  const key = typeof body.key === "string" ? body.key.trim() : "";
  const filename =
    typeof body.filename === "string" ? body.filename.trim() : "";
  const contentType =
    typeof body.contentType === "string" ? body.contentType.trim() : "";
  const size = typeof body.size === "number" ? body.size : -1;

  if (!uploadId || !key || !filename || !contentType || size < 1) {
    return NextResponse.json(
      {
        error:
          "uploadId, key, filename, contentType, and positive size are all required",
      },
      { status: 400 },
    );
  }

  // Detect mode
  const isMultipart = body.mode === "multipart" || Array.isArray(body.parts);

  // ── TTL ──
  const minTtl = Number(env.MIN_SHARE_TTL);
  const maxTtl = Number(env.MAX_SHARE_TTL);
  let ttl = maxTtl;
  if (body.ttl !== undefined && body.ttl !== null) {
    const requested = Number(body.ttl);
    if (!Number.isFinite(requested)) {
      return NextResponse.json(
        { error: "ttl must be a number" },
        { status: 400 },
      );
    }
    if (requested < minTtl || requested > maxTtl) {
      return NextResponse.json(
        { error: `ttl must be in [${minTtl}, ${maxTtl}] seconds` },
        { status: 400 },
      );
    }
    ttl = requested;
  }

  // ── Password ──
  let passwordHash: string | undefined;
  let passwordSalt: string | undefined;
  if (
    body.password !== undefined &&
    body.password !== null &&
    body.password !== ""
  ) {
    if (!isValidPassword(body.password)) {
      return NextResponse.json(
        { error: "password must be 1-256 characters" },
        { status: 400 },
      );
    }
    const hashed = hashPassword(body.password as string);
    passwordHash = hashed.hash;
    passwordSalt = hashed.salt;
  }

  // ── Per-IP daily quota pre-check ──
  const dayKey = utcDayKey();
  const maxBytes = Number(env.MAX_DAILY_BYTES_PER_IP);
  const maxCount = Number(env.MAX_DAILY_COUNT_PER_IP);

  const quota = await readQuota(env, ip, dayKey);
  if (quota) {
    if (quota.totalBytes + size > maxBytes) {
      await audit(env, {
        ip,
        action: "complete",
        status: 429,
        detail: { reason: "quota-bytes", quota },
      });
      return NextResponse.json(
        { error: `Daily upload limit exceeded (max ${maxBytes} bytes per IP)` },
        { status: 429 },
      );
    }
    if (quota.count + 1 > maxCount) {
      await audit(env, {
        ip,
        action: "complete",
        status: 429,
        detail: { reason: "quota-count", quota },
      });
      return NextResponse.json(
        { error: `Daily file count exceeded (max ${maxCount} files per IP)` },
        { status: 429 },
      );
    }
  }

  const client = createS3Client(env);

  // ──────────────────────────────────────────────────────────────────
  //  MULTIPART: complete the S3 multipart upload
  // ──────────────────────────────────────────────────────────────────
  if (isMultipart) {
    const s3UploadId =
      typeof body.s3UploadId === "string" ? body.s3UploadId.trim() : "";
    const rawParts = body.parts;

    if (!s3UploadId || !Array.isArray(rawParts) || rawParts.length === 0) {
      return NextResponse.json(
        {
          error: "multipart mode requires s3UploadId and non-empty parts array",
        },
        { status: 400 },
      );
    }

    const parts: CompletedPart[] = [];
    for (const p of rawParts) {
      if (
        typeof p !== "object" ||
        p === null ||
        typeof (p as Record<string, unknown>).partNumber !== "number" ||
        typeof (p as Record<string, unknown>).etag !== "string"
      ) {
        return NextResponse.json(
          {
            error: "each part must have partNumber (number) and etag (string)",
          },
          { status: 400 },
        );
      }
      parts.push({
        partNumber: (p as Record<string, unknown>).partNumber as number,
        etag: ((p as Record<string, unknown>).etag as string).replace(/"/g, ""),
      });
    }

    try {
      await completeMultipartUpload({
        client,
        bucket: bucketName(env),
        key,
        uploadId: s3UploadId,
        parts,
      });
    } catch (err) {
      await audit(env, {
        ip,
        action: "complete",
        status: 500,
        detail: {
          reason: "multipart-complete-failed",
          key,
          s3UploadId,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      return NextResponse.json(
        { error: "Failed to finalize multipart upload on S3" },
        { status: 500 },
      );
    }

    // ── Mint token ──
    const expiresAt = Date.now() + ttl * 1000;
    let token: string;
    try {
      const r = await createShare(env, {
        bucket: env.S3_BUCKET,
        s3Key: key,
        filename,
        sizeBytes: size,
        contentType,
        expiresAt,
        ip,
        userAgent,
        passwordHash,
        passwordSalt,
      });
      token = r.token;
    } catch (err) {
      await audit(env, {
        ip,
        action: "complete",
        status: 500,
        detail: {
          reason: "create-share-failed",
          error: err instanceof Error ? err.message : String(err),
        },
      });
      return NextResponse.json(
        { error: "Failed to mint share token" },
        { status: 500 },
      );
    }

    // ── Increment quota ──
    try {
      await incrementQuota(env, { ip, day: dayKey, bytes: size });
    } catch {
      // non-fatal
    }

    await audit(env, {
      ip,
      action: "complete",
      shareToken: token,
      status: 200,
      detail: { key, size, expiresAt, mode: "multipart", parts: parts.length },
    });

    const base = new URL(request.url).origin;
    return NextResponse.json({
      shareToken: token,
      shareUrl: `/d/${token}`,
      fullUrl: `${base}/d/${token}`,
      expiresAt,
    });
  }

  // ──────────────────────────────────────────────────────────────────
  //  SINGLE: original flow with etag-based verification
  // ──────────────────────────────────────────────────────────────────
  const etag = typeof body.etag === "string" ? body.etag.trim() : "";
  if (!etag) {
    return NextResponse.json(
      { error: "etag is required for single upload mode" },
      { status: 400 },
    );
  }

  // Best-effort verification
  let verified = false;
  try {
    const head = await client.send(
      new HeadObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
      }),
    );
    const objSize = head.ContentLength ?? -1;
    const objEtag = (head.ETag ?? "").replace(/"/g, "");
    if (objSize === size && objEtag === etag.replace(/"/g, "")) {
      verified = true;
    } else {
      console.warn("[complete] S3 verification mismatch", {
        key,
        clientSize: size,
        clientEtag: etag,
        objSize,
        objEtag,
      });
    }
  } catch (err) {
    console.warn("[complete] S3 verification unavailable (expected on MinIO)", {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (!verified) {
    await audit(env, {
      ip,
      action: "complete",
      status: 200,
      detail: {
        reason: "verify-skipped",
        key,
        size,
        etag,
        s3Error:
          "MinIO blocks per-object operations from Workers; trusting client-reported PUT success",
      },
    });
  }

  // ── Mint token ──
  const expiresAt = Date.now() + ttl * 1000;
  let token: string;
  try {
    const r = await createShare(env, {
      bucket: env.S3_BUCKET,
      s3Key: key,
      filename,
      sizeBytes: size,
      contentType,
      expiresAt,
      ip,
      userAgent,
      passwordHash,
      passwordSalt,
    });
    token = r.token;
  } catch (err) {
    await audit(env, {
      ip,
      action: "complete",
      status: 500,
      detail: {
        reason: "create-share-failed",
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return NextResponse.json(
      { error: "Failed to mint share token" },
      { status: 500 },
    );
  }

  // ── Increment quota ──
  try {
    await incrementQuota(env, { ip, day: dayKey, bytes: size });
  } catch {
    // non-fatal
  }

  await audit(env, {
    ip,
    action: "complete",
    shareToken: token,
    status: 200,
    detail: { key, size, expiresAt, mode: "single" },
  });

  const base = new URL(request.url).origin;
  return NextResponse.json({
    shareToken: token,
    shareUrl: `/d/${token}`,
    fullUrl: `${base}/d/${token}`,
    expiresAt,
  });
}
