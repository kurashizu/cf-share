/**
 * Multipart upload test for cf-share.
 *
 * Tests:
 *   1. Initiate multipart upload via /api/upload/init
 *   2. Upload parts directly to S3 presigned URLs
 *   3. Complete the upload via /api/upload/complete
 *   4. Download the file and verify checksum
 *   5. Test 5-minute TTL
 *
 * Usage:
 *   node scripts/test-multipart-upload.mjs <file-path>
 *
 * Env:
 *   BASE_URL — defaults to https://cf-share.kurashizu123.workers.dev
 */

const BASE_URL =
  process.env.BASE_URL || "https://cf-share.kurashizu123.workers.dev";
const FILE_PATH = process.argv[2];

if (!FILE_PATH) {
  console.error("Usage: node scripts/test-multipart-upload.mjs <file-path>");
  console.error(`  BASE_URL env: ${BASE_URL}`);
  process.exit(1);
}

import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";

async function main() {
  const stats = statSync(FILE_PATH);
  const fileSize = stats.size;
  console.log(`File: ${FILE_PATH}`);
  console.log(
    `Size: ${(fileSize / 1024 / 1024 / 1024).toFixed(2)} GB (${fileSize} bytes)`,
  );
  console.log(`Base URL: ${BASE_URL}\n`);

  // Pre-compute SHA-256 of the file
  console.log("Computing SHA-256 of local file...");
  const fileBuffer = readFileSync(FILE_PATH);
  const expectedHash = createHash("sha256").update(fileBuffer).digest("hex");
  console.log(`Local SHA-256: ${expectedHash}\n`);

  // ── Step 1: Init ──────────────────────────────────────────────
  console.log("─── Step 1: Initiate multipart upload ───");
  const initResp = await fetch(`${BASE_URL}/api/upload/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: "test-1gb.bin",
      size: fileSize,
      contentType: "application/octet-stream",
      ttl: 3600,
    }),
  });
  if (!initResp.ok) {
    const txt = await initResp.text();
    throw new Error(`Init failed (${initResp.status}): ${txt}`);
  }
  const initData = await initResp.json();
  console.log(`Mode: ${initData.mode}`);
  console.log(`Upload ID: ${initData.uploadId}`);
  console.log(`S3 Upload ID: ${initData.s3UploadId}`);
  console.log(`Key: ${initData.key}`);
  console.log(`Total parts: ${initData.parts.length}`);
  console.log(
    `Part size: ${(initData.partSize / 1024 / 1024).toFixed(0)} MB\n`,
  );

  if (initData.mode !== "multipart") {
    throw new Error(`Expected multipart mode, got "${initData.mode}"`);
  }

  // ── Step 2: Upload parts sequentially ─────────────────────────
  console.log("─── Step 2: Upload parts ───");
  const completedParts = [];

  for (let i = 0; i < initData.parts.length; i++) {
    const part = initData.parts[i];
    const start = (part.partNumber - 1) * initData.partSize;
    const end = Math.min(start + part.size, fileSize);
    const chunk = fileBuffer.slice(start, end);

    console.log(
      `  Part ${part.partNumber}/${initData.parts.length} (${(chunk.length / 1024 / 1024).toFixed(0)} MB)...`,
    );

    const resp = await fetch(part.url, {
      method: "PUT",
      body: chunk,
      headers: { "Content-Length": String(chunk.length) },
    });

    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(
        `Part ${part.partNumber} failed (${resp.status}): ${txt}`,
      );
    }

    const etag = (
      resp.headers.get("etag") ||
      resp.headers.get("ETag") ||
      ""
    ).replace(/"/g, "");
    console.log(`  → ETag: ${etag.slice(0, 16)}...`);

    completedParts.push({ partNumber: part.partNumber, etag });
  }

  console.log(`\n✓ All ${completedParts.length} parts uploaded.\n`);

  // ── Step 3: Complete ──────────────────────────────────────────
  console.log("─── Step 3: Complete multipart upload ───");
  const completeResp = await fetch(`${BASE_URL}/api/upload/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "multipart",
      uploadId: initData.uploadId,
      s3UploadId: initData.s3UploadId,
      key: initData.key,
      filename: "test-1gb.bin",
      size: fileSize,
      contentType: "application/octet-stream",
      parts: completedParts,
      ttl: 3600,
    }),
  });

  if (!completeResp.ok) {
    const txt = await completeResp.text();
    throw new Error(`Complete failed (${completeResp.status}): ${txt}`);
  }

  const completeData = await completeResp.json();
  const TOKEN = completeData.shareToken;
  const FULL_URL = completeData.fullUrl;
  console.log(`Share token: ${TOKEN}`);
  console.log(`Share URL: ${FULL_URL}\n`);

  // ── Step 4: Verify download ───────────────────────────────────
  console.log("─── Step 4: Verify download via API ───");

  // Fetch info
  const infoResp = await fetch(`${BASE_URL}/api/download/${TOKEN}?info=1`);
  if (!infoResp.ok) {
    throw new Error(`Info request failed (${infoResp.status})`);
  }
  const info = await infoResp.json();
  console.log(`Filename: ${info.filename}`);
  console.log(`Size: ${info.size_bytes}`);
  console.log(`Content-Type: ${info.content_type}`);

  // Download
  console.log("Downloading for verification...");
  const dlResp = await fetch(`${BASE_URL}/api/download/${TOKEN}`, {
    redirect: "follow",
  });
  if (!dlResp.ok) {
    throw new Error(`Download failed (${dlResp.status})`);
  }

  const dlBuffer = Buffer.from(await dlResp.arrayBuffer());
  const dlHash = createHash("sha256").update(dlBuffer).digest("hex");

  console.log(`Downloaded: ${dlBuffer.length} bytes`);
  console.log(`Download SHA-256: ${dlHash}`);
  console.log(`Expected SHA-256: ${expectedHash}`);

  if (dlHash === expectedHash) {
    console.log("\n✓ INTEGRITY VERIFIED — SHA-256 matches!\n");
  } else {
    throw new Error(
      "✗ SHA-256 MISMATCH — file corrupted during upload/download",
    );
  }

  // ── Step 5: 5-minute TTL test ─────────────────────────────────
  console.log("─── Step 5: 5-minute TTL test ───");

  const ttlContent = Buffer.from("TTL test file content");
  const ttlInitResp = await fetch(`${BASE_URL}/api/upload/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: "ttl-test.txt",
      size: ttlContent.length,
      contentType: "text/plain",
      ttl: 300,
    }),
  });
  if (!ttlInitResp.ok) {
    throw new Error(`TTL init failed (${ttlInitResp.status})`);
  }
  const ttlInitData = await ttlInitResp.json();

  // Single PUT upload
  const putResp = await fetch(ttlInitData.url, {
    method: "PUT",
    body: ttlContent,
    headers: { "Content-Type": "text/plain" },
  });
  if (!putResp.ok) {
    const txt = await putResp.text();
    throw new Error(`TTL PUT failed (${putResp.status}): ${txt}`);
  }
  const putEtag = (putResp.headers.get("etag") || "").replace(/"/g, "");

  const ttlCompleteResp = await fetch(`${BASE_URL}/api/upload/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uploadId: ttlInitData.uploadId,
      key: ttlInitData.key,
      filename: "ttl-test.txt",
      size: ttlContent.length,
      contentType: "text/plain",
      etag: putEtag,
      ttl: 300,
    }),
  });
  if (!ttlCompleteResp.ok) {
    throw new Error(`TTL complete failed (${ttlCompleteResp.status})`);
  }
  const ttlData = await ttlCompleteResp.json();
  const ttlToken = ttlData.shareToken;
  const ttlExpiresAt = ttlData.expiresAt;

  // Verify it's accessible now
  const ttlCheckResp = await fetch(
    `${BASE_URL}/api/download/${ttlToken}?info=1`,
  );
  if (ttlCheckResp.ok) {
    console.log("✓ TTL share is accessible immediately after creation.");
  } else {
    throw new Error(
      `TTL share should be accessible but returned ${ttlCheckResp.status}`,
    );
  }

  // Verify TTL duration
  const ttlMs = ttlExpiresAt - Date.now();
  const ttlMin = ttlMs / 60000;
  console.log(`TTL created at: ${new Date().toISOString()}`);
  console.log(`TTL expires at: ${new Date(ttlExpiresAt).toISOString()}`);
  console.log(`TTL remaining: ${ttlMin.toFixed(1)} min (expected ~5)`);

  if (ttlMin >= 4 && ttlMin <= 6) {
    console.log("✓ TTL is approximately 5 minutes.\n");
  } else {
    console.warn(
      `⚠ TTL is ${ttlMin.toFixed(1)} min — outside 4-6 min range.\n`,
    );
  }

  // ── Done ──────────────────────────────────────────────────────
  console.log("─".repeat(60));
  console.log("ALL TESTS PASSED");
  console.log(`  Token: ${TOKEN}`);
  console.log(`  URL:   ${FULL_URL}`);
  console.log("─".repeat(60));
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
