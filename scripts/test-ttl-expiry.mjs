/**
 * TTL expiry test: verify that a share becomes inaccessible after its TTL.
 *
 * 1. Create a share with 5-minute TTL
 * 2. Verify it's accessible immediately
 * 3. Wait until 10 seconds AFTER expiry
 * 4. Verify it returns 404
 */

const BASE_URL = process.env.BASE_URL || "https://cf-share.kurashizu123.workers.dev";

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  // Create a small share with 5-minute TTL
  const content = "TTL expiry test - will self-destruct!";
  const initResp = await fetch(`${BASE_URL}/api/upload/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: "ttl-expiry-test.txt",
      size: content.length,
      contentType: "text/plain",
      ttl: 300,
    }),
  });
  if (!initResp.ok) throw new Error(`Init: ${initResp.status} ${await initResp.text()}`);
  const init = await initResp.json();

  // PUT
  const putResp = await fetch(init.url, { method: "PUT", body: content });
  if (!putResp.ok) throw new Error(`PUT: ${putResp.status} ${await putResp.text()}`);
  const etag = (putResp.headers.get("etag") || "").replace(/"/g, "");

  // Complete
  const compResp = await fetch(`${BASE_URL}/api/upload/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uploadId: init.uploadId,
      key: init.key,
      filename: "ttl-expiry-test.txt",
      size: content.length,
      contentType: "text/plain",
      etag,
      ttl: 300,
    }),
  });
  if (!compResp.ok) throw new Error(`Complete: ${compResp.status} ${await compResp.text()}`);
  const data = await compResp.json();
  const token = data.shareToken;
  const expiresAt = data.expiresAt;

  console.log(`Share created: /d/${token}`);
  console.log(`Created at:  ${new Date().toISOString()}`);
  console.log(`Expires at:  ${new Date(expiresAt).toISOString()}`);
  console.log(`TTL:         ${((expiresAt - Date.now()) / 1000).toFixed(0)}s remaining\n`);

  // Verify accessible NOW
  const nowResp = await fetch(`${BASE_URL}/api/download/${token}?info=1`);
  console.log(`Immediate check: ${nowResp.status} ${nowResp.ok ? "✓ accessible" : "✗ FAIL"}`);
  if (!nowResp.ok) {
    console.error("Share should be accessible immediately but is not!");
    process.exit(1);
  }

  // Calculate how long to wait
  const waitMs = Math.max(0, expiresAt - Date.now()) + 10_000; // 10s after expiry
  const waitMin = Math.ceil(waitMs / 60000);
  console.log(`\nWaiting ${(waitMs / 1000).toFixed(0)}s (~${waitMin} min) for share to expire...`);

  // Wait with progress updates
  const startWait = Date.now();
  while (Date.now() - startWait < waitMs) {
    const remaining = waitMs - (Date.now() - startWait);
    if (remaining > 60000 && (remaining % 60000 < 1000)) {
      console.log(`  ${Math.ceil(remaining / 60000)} min remaining...`);
    } else if (remaining < 10000) {
      console.log(`  ${remaining}s remaining...`);
    }
    await wait(5000);
  }

  console.log("\nChecking after expiry...");

  // Verify it's NOW inaccessible (404)
  const expiredResp = await fetch(`${BASE_URL}/api/download/${token}?info=1`, {
    // Don't follow redirects — we want the HTTP status
    redirect: "manual",
  });

  const expiredStatus = expiredResp.status;
  let expiredBody = "";
  try { expiredBody = await expiredResp.text(); } catch {}

  console.log(`After-expiry check: HTTP ${expiredStatus}`);

  if (expiredStatus === 404) {
    console.log("✓ CORRECT — expired share returns 404 (Not found)");
  } else if (expiredStatus === 200) {
    console.error("✗ FAIL — expired share still returns 200!");
    console.error(`  Body: ${expiredBody}`);
    process.exit(1);
  } else {
    console.error(`✗ UNEXPECTED — got HTTP ${expiredStatus}`);
    console.error(`  Body: ${expiredBody}`);
    process.exit(1);
  }

  console.log("\n✓ TTL expiry test PASSED");
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
