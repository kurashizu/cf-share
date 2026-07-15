import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";
import { createS3Client, bucketName } from "../../../../lib/s3/client";
import {
  presignParts,
  shouldUseMultipart,
  computeMissingParts,
  type PartPresign,
  type UploadedPart,
  MULTIPART_PART_SIZE,
} from "../../../../lib/s3/multipart";
import { checkRateLimit } from "../../../../lib/rate-limit/check";
import { getClientIp } from "../../../../lib/util/ip";
import { audit } from "../../../../lib/util/audit";

export const runtime = "nodejs";

interface ResumeBody {
  s3UploadId?: unknown;
  key?: unknown;
  size?: unknown;
  /** Part numbers the client already PUT successfully (from localStorage). */
  uploadedPartNumbers?: unknown;
}

interface ResumeResponse {
  mode: "multipart";
  uploadId: string;
  s3UploadId: string;
  key: string;
  /** Presigned URLs for the parts still needed. */
  parts: PartPresign[];
  partSize: number;
  expiresIn: number;
}

/**
 * POST /api/upload/resume
 *
 * Body: { s3UploadId, key, size, uploadedPartNumbers: number[] }
 *
 * Returns fresh presigned URLs for the parts still missing from S3.
 *
 * Why client-side state instead of server-side ListParts:
 *   The S3 endpoint behind the Cloudflare WAF rejects `ListParts` requests
 *   from the AWS SDK (CF error 1010 on the SDK's request signature). Other
 *   S3 commands work fine. The client tracks uploaded parts in localStorage
 *   (see components/uploader/lib/resume.ts) and ships them with this
 *   request. If localStorage is wiped, the user starts a fresh upload and
 *   the abandoned session is reaped by the cleanup cron.
 *
 * Note: this endpoint does NOT verify that the caller is the original
 * uploader. The s3UploadId is opaque and only obtainable via
 * /api/upload/init (which is itself rate-limited). Re-signing URLs does
 * not let an attacker redirect the upload to a different bucket/key — the
 * signature binds bucket+key.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const { env } = await getCloudflareContext();
  const ip = getClientIp(request);

  try {
    return await handleResume(request, env, ip);
  } catch (err) {
    console.error("[resume] unhandled error", {
      err: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

async function handleResume(
  request: Request,
  env: Awaited<ReturnType<typeof getCloudflareContext>>["env"],
  ip: string,
): Promise<NextResponse> {
  const rl = await checkRateLimit(env, "UPLOAD_INIT_LIMIT", ip);
  if (!rl.success) {
    await audit(env, {
      ip,
      action: "init",
      status: 429,
      detail: { reason: "rate-limit", source: "resume" },
    });
    return NextResponse.json({ error: "Too Many Requests" }, { status: 429 });
  }

  let body: ResumeBody;
  try {
    body = (await request.json()) as ResumeBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const s3UploadId =
    typeof body.s3UploadId === "string" ? body.s3UploadId.trim() : "";
  const key = typeof body.key === "string" ? body.key.trim() : "";
  const size = typeof body.size === "number" ? body.size : -1;

  if (!s3UploadId || !key || size < 1) {
    return NextResponse.json(
      { error: "s3UploadId, key, and positive size are required" },
      { status: 400 },
    );
  }

  if (!shouldUseMultipart(size)) {
    // Single-PUT uploads can't be resumed — there's nothing to skip.
    return NextResponse.json(
      {
        error:
          "resume is only valid for multipart uploads; restart with /api/upload/init",
      },
      { status: 400 },
    );
  }

  // Validate uploadedPartNumbers — must be an array of positive integers.
  // We accept whatever the client claims (it's their localStorage, they
  // know what they PUT). Anything they lie about will fail at the
  // CompleteMultipartUpload step (S3 will reject unknown parts).
  const uploadedPartNumbers: number[] = [];
  if (Array.isArray(body.uploadedPartNumbers)) {
    for (const n of body.uploadedPartNumbers) {
      if (
        typeof n === "number" &&
        Number.isInteger(n) &&
        n >= 1 &&
        n <= 100_000
      ) {
        uploadedPartNumbers.push(n);
      }
    }
  }

  const client = createS3Client(env);
  const expiresIn = Number(env.UPLOAD_URL_TTL);

  const missing = computeMissingParts(
    size,
    new Set(uploadedPartNumbers),
  );

  // Presign only the missing parts. ETags of uploaded parts can be reused
  // verbatim in the eventual /api/upload/complete call.
  let parts: PartPresign[] = [];
  if (missing.length > 0) {
    try {
      parts = await presignParts({
        client,
        bucket: bucketName(env),
        key,
        uploadId: s3UploadId,
        partNumbers: missing,
        expiresIn,
      });
    } catch (err) {
      await audit(env, {
        ip,
        action: "init",
        status: 500,
        detail: {
          reason: "resume-presign-failed",
          key,
          s3UploadId,
          missing: missing.length,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      return NextResponse.json(
        { error: "Failed to sign part URLs" },
        { status: 500 },
      );
    }
  }

  // Fill in the actual byte size for each part so the client can slice
  // the file correctly without needing to compute it itself.
  const partSize = MULTIPART_PART_SIZE;
  for (const p of parts) {
    const offset = (p.partNumber - 1) * partSize;
    p.size = Math.min(partSize, size - offset);
  }

  await audit(env, {
    ip,
    action: "init",
    status: 200,
    detail: {
      mode: "resume",
      s3UploadId,
      key,
      size,
      totalParts: Math.ceil(size / partSize),
      alreadyUploaded: uploadedPartNumbers.length,
      stillNeeded: parts.length,
    },
  });

  // The "our" uploadId here is a fresh correlation token so audit log
  // entries from this resume are traceable. The original /init uploadId is
  // not echoed back; the s3UploadId is what matters for S3 operations.
  const ourUploadId = `rs_${crypto.randomUUID().replace(/-/g, "")}`;

  const response: ResumeResponse = {
    mode: "multipart",
    uploadId: ourUploadId,
    s3UploadId,
    key,
    parts,
    partSize,
    expiresIn,
  };
  return NextResponse.json(response);
}

// Silence "unused" warnings for the legacy type when bundled.
export type { UploadedPart };