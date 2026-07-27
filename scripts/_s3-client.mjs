/**
 * Shared S3 client + .dev.vars loader for ad-hoc debug scripts.
 *
 * Reads `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
 * `S3_SECRET_ACCESS_KEY` from process.env, falling back to values from
 * the project's `.dev.vars` (Wrangler's local secret file).
 *
 * Never hard-code credentials here. If `.dev.vars` is missing or
 * contains placeholders, we throw with a helpful message.
 *
 * Usage:
 *   import { createS3Client } from "./_s3-client.mjs";
 *   const c = createS3Client();
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { S3Client } from "@aws-sdk/client-s3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

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
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadDevVars();

function need(key) {
  const v = process.env[key];
  if (!v || v === "__REPLACE_ME__") {
    throw new Error(
      `Missing ${key}. Set it in .dev.vars or export it before running this script.`,
    );
  }
  return v;
}

export function createS3Client({ forcePathStyle = true } = {}) {
  return new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: need("S3_ENDPOINT"),
    forcePathStyle,
    credentials: {
      accessKeyId: need("S3_ACCESS_KEY_ID"),
      secretAccessKey: need("S3_SECRET_ACCESS_KEY"),
    },
  });
}

export function getBucket() {
  return need("S3_BUCKET");
}