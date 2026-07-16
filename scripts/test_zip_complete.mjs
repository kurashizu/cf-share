/**
 * End-to-end single-PUT complete test against the deployment.
 * Verifies the HeadObject try/catch fix in app/api/upload/complete/route.ts.
 *
 * Run:
 *   BASE_URL=https://share.krsz.in node scripts/test_zip_complete.mjs
 */

const BASE = process.env.BASE_URL || "https://share.krsz.in";

function ts() { return new Date().toISOString().slice(11, 19); }
function log(...a) { console.log(`[${ts()}]`, ...a); }

function makeMinimalZip(text) {
  const enc = new TextEncoder();
  const data = enc.encode(text);
  const filename = enc.encode("hello.txt");

  let crc = 0xffffffff;
  for (const b of data) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  crc = (crc ^ 0xffffffff) >>> 0;

  const u32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
  const u16 = (n) => [n & 0xff, (n >>> 8) & 0xff];

  const lfh = [...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0),
               ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length),
               ...u32(data.length), ...u16(filename.length), ...u16(0), ...filename];
  const cdh = [...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0),
               ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length),
               ...u32(data.length), ...u16(filename.length), ...u16(0), ...u16(0),
               ...u16(0), ...u16(0), ...u32(0), ...u32(0), ...filename];
  const eocd = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(1),
                ...u16(1), ...u32(cdh.length), ...u32(lfh.length), ...u16(0)];
  return new Uint8Array([...lfh, ...data, ...cdh, ...eocd]);
}

async function uploadOnce({ filename, contentType, body }) {
  const initResp = await fetch(`${BASE}/api/upload/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, size: body.length, contentType, ttl: 3600 }),
  });
  const initTxt = await initResp.text();
  if (!initResp.ok) throw new Error(`init ${initResp.status}: ${initTxt}`);
  const init = JSON.parse(initTxt);
  if (init.mode !== "single") {
    throw new Error(`expected single mode, got ${init.mode} for size ${body.length}`);
  }

  const putResp = await fetch(init.url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body,
  });
  const etag = (putResp.headers.get("etag") || putResp.headers.get("ETag") || "")
    .replace(/"/g, "");
  if (!putResp.ok) throw new Error(`PUT ${putResp.status}`);
  if (!etag) throw new Error("PUT returned no etag");

  const compResp = await fetch(`${BASE}/api/upload/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uploadId: init.uploadId,
      key: init.key,
      filename,
      size: body.length,
      contentType,
      etag,
      ttl: 3600,
    }),
  });
  const compTxt = await compResp.text();
  return { initStatus: initResp.status, putStatus: putResp.status,
           completeStatus: compResp.status, completeBody: compTxt, etag, init };
}

async function expect(name, payload) {
  log(`→ ${name}`);
  const r = await uploadOnce(payload);
  if (r.completeStatus !== 200) {
    throw new Error(`${name} complete ${r.completeStatus}: ${r.completeBody}`);
  }
  const j = JSON.parse(r.completeBody);
  log(`  ✓ complete 200, shareToken=${j.shareToken}, expiresAt=${new Date(j.expiresAt).toISOString()}`);
  return j;
}

async function run() {
  log(`Testing ${BASE}`);

  // A: zip — exercises the path the user reported
  const zip = makeMinimalZip("hello from a test zip\n");
  const A = await expect("A.zip (< 90MB → single PUT)", {
    filename: "sample.zip",
    contentType: "application/zip",
    body: zip,
  });
  log(`  download page:`);
  const pageA = await fetch(A.fullUrl);
  const pageAhtml = await pageA.text();
  log(`    GET ${A.fullUrl} → ${pageA.status}, html len=${pageAhtml.length}, mentions filename? ${
    pageAhtml.includes("sample.zip") ? "yes" : "no"
  }`);

  // B: octet-stream control
  const txt = new TextEncoder().encode("plain text payload for control test\n");
  const B = await expect("B.octet-stream (control)", {
    filename: "control.txt",
    contentType: "application/octet-stream",
    body: txt,
  });

  // C: tar.gz-ish name, application/gzip contentType
  const gz = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, ...new TextEncoder().encode("fake gzip body")]);
  const C = await expect("C.tar.gz (other application/*)", {
    filename: "archive.tar.gz",
    contentType: "application/gzip",
    body: gz,
  });

  log("");
  log("Summary:");
  log(`  A.zip          → shareToken ${A.shareToken}`);
  log(`  B.octet-stream → shareToken ${B.shareToken}`);
  log(`  C.tar.gz       → shareToken ${C.shareToken}`);
  log("");
  log("DONE ✅");
}

run().catch((e) => {
  console.error("FAIL ❌", e.message);
  process.exit(1);
});
