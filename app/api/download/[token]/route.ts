import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";
import { createS3Client } from "../../../../lib/s3/client";
import { presignGet } from "../../../../lib/s3/presign";
import { getShare, recordDownload } from "../../../../lib/share/store";
import { verifyPassword } from "../../../../lib/share/password";
import { checkRateLimit } from "../../../../lib/rate-limit/check";
import { getClientIp } from "../../../../lib/util/ip";
import { audit } from "../../../../lib/util/audit";
import { isValidToken } from "../../../../lib/share/token";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ token: string }>;
}

function passwordRequiredResponse(): Response {
  return new Response(
    JSON.stringify({ error: "Password required", password_protected: true }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
}

/**
 * GET /api/download/:token
 *
 *   ?info=1   → return share metadata as JSON (includes has_password).
 *   default    → 302 to a presigned S3 GET URL (if no password).
 *   ?password= → verify password and redirect (if password-protected).
 *
 * Password-protected shares require a password via query parameter.
 * Missing / expired / wrong password all return 404/401.
 */
export async function GET(
  request: Request,
  ctx: RouteContext,
): Promise<Response> {
  const { env } = await getCloudflareContext();
  const { token } = await ctx.params;
  const ip = getClientIp(request);

  // Rate-limit download lookups
  const rl = await checkRateLimit(env, "DOWNLOAD_LOOKUP_LIMIT", ip);
  if (!rl.success) {
    await audit(env, {
      ip,
      action: "download",
      shareToken: token,
      status: 429,
      detail: { reason: "rate-limit" },
    });
    return NextResponse.json({ error: "Too Many Requests" }, { status: 429 });
  }

  if (!isValidToken(token)) {
    return notFoundResponse();
  }

  const share = await getShare(env, token);
  if (!share) {
    await audit(env, {
      ip,
      action: "download",
      shareToken: token,
      status: 404,
      detail: { reason: "missing-or-expired" },
    });
    return notFoundResponse();
  }

  const hasPassword = !!share.password_hash;

  const url = new URL(request.url);
  if (url.searchParams.get("info") === "1") {
    return NextResponse.json({
      filename: share.filename,
      size_bytes: share.size_bytes,
      content_type: share.content_type,
      expires_at: share.expires_at,
      download_count: share.download_count,
      has_password: hasPassword,
    });
  }

  // ── Password verification ──
  const providedPassword = url.searchParams.get("password") ?? "";
  if (hasPassword) {
    if (
      !providedPassword ||
      !verifyPassword(
        providedPassword,
        share.password_salt!,
        share.password_hash!,
      )
    ) {
      await audit(env, {
        ip,
        action: "download",
        shareToken: token,
        status: 401,
        detail: {
          reason:
            hasPassword && !providedPassword
              ? "password-required"
              : "wrong-password",
        },
      });
      return passwordRequiredResponse();
    }
  }

  // Increment + redirect
  await recordDownload(env, token);

  const client = createS3Client(env);
  const dlUrl = await presignGet({
    client,
    bucket: share.bucket,
    key: share.s3_key,
    expiresIn: Number(env.DOWNLOAD_URL_TTL),
    filename: share.filename,
  });

  await audit(env, {
    ip,
    action: "download",
    shareToken: token,
    status: 302,
    detail: hasPassword ? { password_protected: true } : undefined,
  });

  return Response.redirect(dlUrl, 302);
}

/**
 * POST /api/download/:token
 *
 * Verify password for password-protected shares.
 * Body: { password: string }
 * Returns 200 with { downloadUrl } on success, or 401 on wrong password.
 */
export async function POST(
  request: Request,
  ctx: RouteContext,
): Promise<Response> {
  const { env } = await getCloudflareContext();
  const { token } = await ctx.params;
  const ip = getClientIp(request);

  const rl = await checkRateLimit(env, "DOWNLOAD_LOOKUP_LIMIT", ip);
  if (!rl.success) {
    return NextResponse.json({ error: "Too Many Requests" }, { status: 429 });
  }

  if (!isValidToken(token)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const share = await getShare(env, token);
  if (!share) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: { password?: unknown };
  try {
    body = (await request.json()) as { password?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const password = typeof body.password === "string" ? body.password : "";

  if (!share.password_hash) {
    // No password set — just return the download URL directly
    const client = createS3Client(env);
    const dlUrl = await presignGet({
      client,
      bucket: share.bucket,
      key: share.s3_key,
      expiresIn: Number(env.DOWNLOAD_URL_TTL),
      filename: share.filename,
    });
    return NextResponse.json({ verified: true, downloadUrl: dlUrl });
  }

  if (
    !password ||
    !verifyPassword(password, share.password_salt!, share.password_hash!)
  ) {
    await audit(env, {
      ip,
      action: "download",
      shareToken: token,
      status: 401,
      detail: { reason: "wrong-password" },
    });
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  await recordDownload(env, token);

  const client = createS3Client(env);
  const dlUrl = await presignGet({
    client,
    bucket: share.bucket,
    key: share.s3_key,
    expiresIn: Number(env.DOWNLOAD_URL_TTL),
    filename: share.filename,
  });

  await audit(env, {
    ip,
    action: "download",
    shareToken: token,
    status: 200,
    detail: { password_protected: true },
  });

  return NextResponse.json({ verified: true, downloadUrl: dlUrl });
}

function notFoundResponse(): Response {
  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: {
      "Content-Type": "application/json",
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "public, max-age=60",
    },
  });
}
