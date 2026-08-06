/// <reference path="./cloudflare-env.d.ts" />

// Custom worker that wraps the OpenNext-generated fetch handler and
// adds a scheduled handler for the daily cleanup cron.
//
// Why: OpenNext only emits a default `fetch` export. We need a
// `scheduled` handler for the cron trigger. The official guidance
// (https://opennext.js.org/cloudflare/howtos/custom-worker) is to
// re-export the default and bolt on additional handlers here.
//
// We also re-export `DOQueueHandler` and `DOShardedTagCache` so the
// DO queue + tag cache keep working. (OpenNext docs: required when
// the app uses the DO Queue and DO Tag Cache.)
// @ts-ignore `.open-next/worker.js` is generated at build time
import { default as openNextHandler } from "./.open-next/worker.js";

// @ts-ignore `.open-next/worker.js` is generated at build time
export { DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";

// Polyfill DOM globals for the CF Worker runtime. AWS SDK v3's XML
// deserializer (used by ListObjectsV2, ListMultipartUploads, etc.)
// requires DOMParser, Node, etc. which are unavailable in Workers
// even with nodejs_compat.
import {
  DOMParser,
  Node,
  Document,
  Element,
  Attr,
  Text,
  NodeList,
  NamedNodeMap,
} from "@xmldom/xmldom";
const g = globalThis as Record<string, unknown>;
if (!g.DOMParser) g.DOMParser = DOMParser;
if (!g.Node) g.Node = Node;
if (!g.Document) g.Document = Document;
if (!g.Element) g.Element = Element;
if (!g.Attr) g.Attr = Attr;
if (!g.Text) g.Text = Text;
if (!g.NodeList) g.NodeList = NodeList;
if (!g.NamedNodeMap) g.NamedNodeMap = NamedNodeMap;

import { runCleanup } from "./lib/s3/cleanup";
import { getClientIp } from "./lib/util/ip";
import { checkRateLimit } from "./lib/rate-limit/check";
import { isValidToken } from "./lib/share/token";
import { getShare, recordDownload } from "./lib/share/store";
import { verifyPassword } from "./lib/share/password";
import { createS3Client } from "./lib/s3/client";
import { presignGet } from "./lib/s3/presign";
import { audit } from "./lib/util/audit";

// ─────────────────────────────────────────────────────────────────────
// Native download proxy.
//
// GET /api/download/:token is handled HERE, at the raw Cloudflare Worker
// layer, instead of inside the Next.js route handler. Reason: the route
// handler's Response travels through OpenNext's Next-node-server pipeline
// (response headers include `x-opennext: 1` / `vary: rsc, next-router-*`),
// which streams the proxied body without Content-Length and drops bytes on
// the HTTP/2 END_STREAM boundary — same URL returns 0 / partial / full
// bytes across requests regardless of how the body was constructed
// (direct `upstream.body`, TransformStream pipe, or arrayBuffer buffer).
// Streaming from the native Worker with `new Response(upstream.body, …)`
// bypasses that pipeline entirely.
//
// POST /api/download/:token (password verification) still goes to the
// Next.js route handler.
const DOWNLOAD_RE = /^\/api\/download\/([^/]+)$/;

function downloadJson(
  data: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Robots-Tag": "noindex, nofollow",
      ...extraHeaders,
    },
  });
}

async function handleDownloadGet(
  request: Request,
  env: CloudflareEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const m = DOWNLOAD_RE.exec(url.pathname);
  if (!m || request.method !== "GET") return null;

  const token = m[1];
  const ip = getClientIp(request);

  try {
    // Rate-limit download lookups (same binding as the Next route).
    const rl = await checkRateLimit(env, "DOWNLOAD_LOOKUP_LIMIT", ip);
    if (!rl.success) {
      await audit(env, {
        ip,
        action: "download",
        shareToken: token,
        status: 429,
        detail: { reason: "rate-limit" },
      });
      return downloadJson({ error: "Too Many Requests" }, 429);
    }

    if (!isValidToken(token)) {
      return downloadJson(
        { error: "Not found" },
        404,
        { "Cache-Control": "public, max-age=60" },
      );
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
      return downloadJson(
        { error: "Not found" },
        404,
        { "Cache-Control": "public, max-age=60" },
      );
    }

    const hasPassword = !!share.password_hash;

    if (url.searchParams.get("info") === "1") {
      return downloadJson({
        filename: share.filename,
        size_bytes: share.size_bytes,
        content_type: share.content_type,
        expires_at: share.expires_at,
        download_count: share.download_count,
        has_password: hasPassword,
      });
    }

    // ── Password verification (query param, same semantics as the route) ──
    const providedPassword = url.searchParams.get("password") ?? "";
    if (hasPassword) {
      if (
        !providedPassword ||
        !verifyPassword(providedPassword, share.password_salt!, share.password_hash!)
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
        return downloadJson(
          { error: "Password required", password_protected: true },
          401,
        );
      }
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

    // Forward byte-range headers so paused/resuming downloads work.
    const upstreamHeaders = new Headers();
    for (const h of ["range", "if-range", "if-none-match", "if-modified-since"]) {
      const v = request.headers.get(h);
      if (v) upstreamHeaders.set(h, v);
    }

    const upstream = await fetch(dlUrl, { headers: upstreamHeaders });
    if (!upstream.ok && upstream.status !== 206 && upstream.status !== 304) {
      console.error("[download] S3 proxy request failed", {
        token,
        status: upstream.status,
      });
      return downloadJson(
        { error: "Download failed" },
        upstream.status >= 400 ? upstream.status : 502,
      );
    }

    const responseHeaders = new Headers();
    for (const h of [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "etag",
      "last-modified",
    ]) {
      const v = upstream.headers.get(h);
      if (v) responseHeaders.set(h, v);
    }
    responseHeaders.set(
      "Content-Disposition",
      `attachment; filename="${share.filename.replace(/["\\r\\n]/g, "")}"`,
    );
    responseHeaders.set("Cache-Control", "private, no-store");

    await audit(env, {
      ip,
      action: "download",
      shareToken: token,
      status: upstream.status,
      detail: {
        ...(hasPassword ? { password_protected: true } : {}),
        proxy: true,
        native: true,
      },
    });

    // Native streaming passthrough — canonical CF Worker pattern.
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error("[download] unexpected error", {
      token,
      err: err instanceof Error ? err.message : String(err),
    });
    return downloadJson({ error: "Internal Server Error" }, 500);
  }
}

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response> {
    const download = await handleDownloadGet(request, env);
    if (download) return download;
    return openNextHandler.fetch(request, env, ctx);
  },

  async scheduled(
    event: ScheduledController,
    env: CloudflareEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    const cron = event.cron ?? "unknown";
    const scheduledTime = event.scheduledTime ?? Date.now();
    console.log("[cron] cleanup tick", { cron, scheduledTime });

    try {
      const result = await runCleanup(env);
      console.log("[cron] cleanup complete", result);
    } catch (err) {
      console.error("[cron] cleanup failed", {
        cron,
        err: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      // Re-throw so the platform records the failure and retries next
      // scheduled run (CF cron does not auto-retry on the same tick).
      throw err;
    }

    // ctx is unused but the type signature requires it
    void ctx;
  },
} satisfies ExportedHandler<CloudflareEnv>;
