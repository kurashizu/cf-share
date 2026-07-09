/**
 * S3 connectivity probe for cf-share.
 *
 * Verifies:
 *   1. Credentials + endpoint are reachable.
 *   2. Target bucket exists (or reports that we lack ListBucket permission).
 *   3. PutObject / GetObject / DeleteObject round-trip works.
 *   4. Whether path-style URLs are required.
 *
 * Usage:
 *   npm run s3:ping
 *   # or, with overrides:
 *   S3_ENDPOINT=https://s3api.022025.xyz \
 *   S3_BUCKET=cf-share \
 *   S3_ACCESS_KEY_ID=... \
 *   S3_SECRET_ACCESS_KEY=... \
 *     node scripts/s3-ping.mjs
 *
 * Reads S3_* values from .dev.vars (if present) or process.env.
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — config / credentials missing
 *   2 — endpoint unreachable
 *   3 — round-trip failed
 */

import {
  S3Client,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

// ── Load .dev.vars (Wrangler's local secret file) ────────────────────────────
function loadDevVars() {
  const path = resolve(PROJECT_ROOT, ".dev.vars");
  if (!existsSync(path)) return;
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    // Don't override existing env vars
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadDevVars();

// ── Load non-secret vars from wrangler.jsonc ───────────────────────────────
// We only need flat `vars` (string values). Hand-rolled parser to avoid jsonc
// quirks (trailing commas, comments, unquoted keys).
function loadWranglerVars() {
  const path = resolve(PROJECT_ROOT, "wrangler.jsonc");
  if (!existsSync(path)) return;
  const raw = readFileSync(path, "utf8");
  // Strip /* */ and // comments.
  const noBlock = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const noLine = noBlock.replace(/^\s*\/\/.*$/gm, "");
  // Find the "vars": { ... } block (top-level only, balanced braces).
  const idx = noLine.indexOf('"vars"');
  if (idx < 0) return;
  const braceStart = noLine.indexOf("{", idx);
  if (braceStart < 0) return;
  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < noLine.length; i++) {
    const c = noLine[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return;
  const block = noLine.slice(braceStart + 1, end);
  // Match "KEY": "VALUE" or "KEY": NUMBER pairs.
  const re = /"([^"\\]*)"\s*:\s*(?:"([^"\\]*)"|(-?\d+(?:\.\d+)?))/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    const k = m[1];
    const v = m[2] !== undefined ? m[2] : m[3];
    if (process.env[k] === undefined) process.env[k] = String(v);
  }
}
loadWranglerVars();

// ── Helpers ──────────────────────────────────────────────────────────────────
function need(key) {
  const v = process.env[key];
  if (!v || v === "__REPLACE_ME__") {
    console.error(`✗ Missing or placeholder: ${key}`);
    process.exit(1);
  }
  return v;
}

function ok(msg) {
  console.log(`✓ ${msg}`);
}

function info(msg) {
  console.log(`· ${msg}`);
}

function warn(msg) {
  console.warn(`⚠ ${msg}`);
}

// ── Build client (path-style first, fall back to virtual-hosted) ──────────────
async function tryClient({
  endpoint,
  region,
  accessKeyId,
  secretAccessKey,
  forcePathStyle,
}) {
  return new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle,
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const endpoint = need("S3_ENDPOINT");
  const region = process.env.S3_REGION || "auto";
  const bucket = need("S3_BUCKET");
  const accessKeyId = need("S3_ACCESS_KEY_ID");
  const secretAccessKey = need("S3_SECRET_ACCESS_KEY");

  console.log(
    `\nS3 probe — endpoint=${endpoint} bucket=${bucket} region=${region}\n`,
  );

  // 1. Try path-style first (most common for S3-compatible services)
  let workingClient = null;
  let workingStyle = null;

  for (const forcePathStyle of [true, false]) {
    const style = forcePathStyle ? "path-style" : "virtual-hosted";
    info(`Trying ${style}...`);
    const client = await tryClient({
      endpoint,
      region,
      accessKeyId,
      secretAccessKey,
      forcePathStyle,
    });
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
      workingClient = client;
      workingStyle = style;
      ok(`HeadBucket succeeded with ${style}`);
      break;
    } catch (err) {
      const code = err?.$metadata?.httpStatusCode;
      const name = err?.name || err?.Code || "Unknown";
      if (code === 404) {
        warn(
          `HeadBucket returned 404 with ${style} — bucket '${bucket}' may not exist`,
        );
        workingClient = client;
        workingStyle = style;
        break;
      }
      if (code === 403) {
        // 403 with HeadBucket usually means the bucket exists but we lack permission,
        // OR credentials are wrong. Either way, the endpoint is reachable.
        ok(
          `HeadBucket returned 403 with ${style} (endpoint reachable, bucket may exist)`,
        );
        workingClient = client;
        workingStyle = style;
        break;
      }
      warn(`HeadBucket with ${style} failed: ${name} (HTTP ${code ?? "?"})`);
    }
  }

  if (!workingClient) {
    console.error(
      "\n✗ Could not reach S3 endpoint with either path-style or virtual-hosted URLs.",
    );
    console.error("  Check S3_ENDPOINT and network connectivity.");
    process.exit(2);
  }

  // 2. Round-trip: Put / Get / Delete a small test object
  const probeKey = `__cf-share-ping__/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
  const probeBody = `cf-share ping @ ${new Date().toISOString()}`;

  info(`Round-trip test with key: ${probeKey}`);

  try {
    await workingClient.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: probeKey,
        Body: probeBody,
        ContentType: "text/plain",
      }),
    );
    ok("PutObject succeeded");

    const got = await workingClient.send(
      new GetObjectCommand({ Bucket: bucket, Key: probeKey }),
    );
    const text = await got.Body.transformToString();
    if (text !== probeBody) {
      console.error(`✗ GetObject returned wrong body: ${JSON.stringify(text)}`);
      process.exit(3);
    }
    ok("GetObject succeeded and body matches");

    await workingClient.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: probeKey }),
    );
    ok("DeleteObject succeeded");
  } catch (err) {
    console.error(
      `\n✗ Round-trip failed: ${err?.name || ""} ${err?.message || err}`,
    );
    console.error("  This may indicate missing permissions on the access key.");
    console.error(
      "  Required S3 perms: s3:HeadBucket, s3:PutObject, s3:GetObject, s3:DeleteObject",
    );
    process.exit(3);
  }

  // 3. Summary
  console.log(`\n${"─".repeat(60)}`);
  console.log(`All checks passed.`);
  console.log(`  Endpoint style:    ${workingStyle}`);
  console.log(`  Bucket:            ${bucket}`);
  console.log(`  Region:            ${region}`);
  console.log(`\nNext steps:`);
  console.log(`  - Update wrangler.jsonc if you haven't already.`);
  console.log(
    `  - For local dev, ensure .dev.vars has S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY.`,
  );
  console.log(
    `  - For production, run: npx wrangler secret put S3_ACCESS_KEY_ID`,
  );
  console.log(
    `                          npx wrangler secret put S3_SECRET_ACCESS_KEY`,
  );
  console.log(`${"─".repeat(60)}\n`);
}

main().catch((err) => {
  console.error(`\n✗ Unexpected error: ${err?.stack || err}`);
  process.exit(1);
});
