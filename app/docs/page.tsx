import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "API Documentation — Share",
  description:
    "Agent documentation for the cf-share anonymous file sharing API.",
  robots: { index: false, follow: false },
};

// ── Helpers ──

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">
      {children}
    </code>
  );
}

function Hr() {
  return <hr className="my-8 border-neutral-200 dark:border-neutral-800" />;
}

function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  );
}

function ApiBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="bg-neutral-900 dark:bg-black text-neutral-100 p-4 rounded-lg overflow-x-auto text-sm leading-relaxed">
      <code>{children}</code>
    </pre>
  );
}

function Section({ id, title }: { id: string; title: string }) {
  return (
    <h2
      id={id}
      className="text-2xl font-bold mt-10 mb-4 text-neutral-900 dark:text-neutral-50"
    >
      {title}
    </h2>
  );
}

function Sub({ id, title }: { id: string; title: React.ReactNode }) {
  return (
    <h3
      id={id}
      className="text-xl font-semibold mt-8 mb-3 text-neutral-800 dark:text-neutral-100"
    >
      {title}
    </h3>
  );
}

function Strong({ children }: { children: React.ReactNode }) {
  return (
    <strong className="font-semibold text-neutral-900 dark:text-neutral-50">
      {children}
    </strong>
  );
}

// ── Docs Page ──

export default function DocsPage() {
  return (
    <main className="min-h-screen bg-neutral-50 dark:bg-neutral-950 p-6">
      <article className="max-w-3xl mx-auto prose prose-neutral dark:prose-invert">
        <h1 className="text-4xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 mb-2">
          cf-share API Documentation
        </h1>
        <p className="text-lg text-neutral-600 dark:text-neutral-400 mb-2">
          <Strong>Share</Strong> is a temporary file-sharing service at{" "}
          <a
            href="https://share.022025.xyz"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            share.022025.xyz
          </a>
          . Upload a file, get a short-lived 4-character share link. No login
          required.
        </p>

        <Hr />

        <Section id="quickstart" title="Quick Start (cURL)" />
        <ApiBlock>{`# 1. Upload a file
INIT=$(curl -fsS -X POST "https://share.022025.xyz/api/upload/init" \\
  -H "Content-Type: application/json" \\
  -d '{"filename":"photo.jpg","size":1048576,"contentType":"image/jpeg","ttl":86400}')

UPLOAD_ID=$(echo "$INIT"  | sed -n 's/.*"uploadId":"\\([^"]*\\)".*/\\1/p')
KEY=$(echo "$INIT"        | sed -n 's/.*"key":"\\([^"]*\\)".*/\\1/p')
URL=$(echo "$INIT"        | sed -n 's/.*"url":"\\([^"]*\\)".*/\\1/p')

# 2. PUT file body directly to S3
ETAG=$(curl -fsS -X PUT "$URL" -H "Content-Type: image/jpeg" --data-binary "@photo.jpg" \\
  -D - | tr -d '\\r' | awk 'tolower($1)=="etag:" {gsub(/"/,"",$2); print $2}')

# 3. Finalize → get share link
curl -fsS -X POST "https://share.022025.xyz/api/upload/complete" \\
  -H "Content-Type: application/json" \\
  -d "{\\"uploadId\\":\\"$UPLOAD_ID\\",\\"key\\":\\"$KEY\\",\\"filename\\":\\"photo.jpg\\",\\"size\\":1048576,\\"contentType\\":\\"image/jpeg\\",\\"etag\\":\\"$ETAG\\",\\"ttl\\":86400}"

# 4. Download via share link
curl -fsSL "https://share.022025.xyz/d/ABCD" -o downloaded-file`}</ApiBlock>

        <Hr />

        <Section id="endpoints" title="Endpoints" />

        {/* ── INIT ── */}
        <Sub
          id="post-init"
          title={
            <>
              <Code>POST /api/upload/init</Code> — Reserve a presigned PUT URL
            </>
          }
        />
        <p className="mb-3 text-neutral-700 dark:text-neutral-300">
          Reserve a presigned PUT URL for direct-to-S3 upload. The Worker never
          sees the file bytes.
        </p>
        <Strong>Request body:</Strong>
        <Table>
          <thead>
            <tr className="border-b border-neutral-300 dark:border-neutral-700">
              <th className="text-left py-2 pr-4 font-medium">Field</th>
              <th className="text-left py-2 pr-4 font-medium">Type</th>
              <th className="text-left py-2 pr-4 font-medium">Required</th>
              <th className="text-left py-2 font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">
                <Code>filename</Code>
              </td>
              <td className="py-2 pr-4">string</td>
              <td className="py-2 pr-4">yes</td>
              <td className="py-2">Original file name (max 500 chars)</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">
                <Code>size</Code>
              </td>
              <td className="py-2 pr-4">integer</td>
              <td className="py-2 pr-4">yes</td>
              <td className="py-2">File size in bytes (1 – 5,368,709,120)</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">
                <Code>contentType</Code>
              </td>
              <td className="py-2 pr-4">string</td>
              <td className="py-2 pr-4">yes</td>
              <td className="py-2">
                MIME type (e.g. <Code>image/jpeg</Code>)
              </td>
            </tr>
            <tr>
              <td className="py-2 pr-4">
                <Code>ttl</Code>
              </td>
              <td className="py-2 pr-4">integer</td>
              <td className="py-2 pr-4">no</td>
              <td className="py-2">
                Share lifetime in seconds (3600–604800, default: 604800 = 7d)
              </td>
            </tr>
          </tbody>
        </Table>

        <p className="mt-3 mb-1">
          <Strong>Response 200:</Strong>
        </p>
        <ApiBlock>{`{
  "uploadId": "ul_a1b2c3d4e5f6...",
  "key": "uploads/2026/07/09/tmp-abc12345/photo.jpg",
  "url": "https://s3api.022025.xyz/cf-share/uploads/...?X-Amz-Signature=...",
  "headers": { "Content-Type": "image/jpeg" },
  "expiresIn": 600
}`}</ApiBlock>
        <ul className="list-disc pl-6 mt-2 text-sm text-neutral-600 dark:text-neutral-400 space-y-1">
          <li>
            The <Code>url</Code> is valid for 600 seconds (10 min). Upload
            before it expires.
          </li>
          <li>
            Send the PUT with exactly the <Code>Content-Type</Code> from the
            response headers.
          </li>
          <li>Single file only. No multipart, no ZIP bundling.</li>
        </ul>

        {/* ── PUT ── */}
        <Sub
          id="put-s3"
          title={
            <>
              <Code>PUT {"{url}"}</Code> — Upload to S3
            </>
          }
        />
        <p className="mb-3 text-neutral-700 dark:text-neutral-300">
          Upload the file body directly to S3 using the presigned URL.
        </p>
        <ApiBlock>{`PUT <url-from-init>
Content-Type: <content-type-from-init>

<file-bytes>`}</ApiBlock>
        <p className="mt-3 mb-1">
          <Strong>Response:</Strong> HTTP <Code>200</Code> with{" "}
          <Code>ETag</Code> header.
        </p>
        <ApiBlock>{`HTTP/2 200
etag: "d41d8cd98f00b204e9800998ecf8427e"`}</ApiBlock>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Extract the ETag value (strip quotes). You'll need it for the complete
          step.
        </p>

        {/* ── COMPLETE ── */}
        <Sub
          id="post-complete"
          title={
            <>
              <Code>POST /api/upload/complete</Code> — Finalize &amp; mint token
            </>
          }
        />
        <p className="mb-3 text-neutral-700 dark:text-neutral-300">
          Finalize the upload and mint a 4-character share token. The Worker
          verifies the file on S3 before minting.
        </p>
        <Strong>Request body:</Strong>
        <Table>
          <thead>
            <tr className="border-b border-neutral-300 dark:border-neutral-700">
              <th className="text-left py-2 pr-4 font-medium">Field</th>
              <th className="text-left py-2 pr-4 font-medium">Type</th>
              <th className="text-left py-2 pr-4 font-medium">Required</th>
              <th className="text-left py-2 font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">
                <Code>uploadId</Code>
              </td>
              <td className="py-2 pr-4">string</td>
              <td className="py-2 pr-4">yes</td>
              <td className="py-2">From init response</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">
                <Code>key</Code>
              </td>
              <td className="py-2 pr-4">string</td>
              <td className="py-2 pr-4">yes</td>
              <td className="py-2">From init response</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">
                <Code>filename</Code>
              </td>
              <td className="py-2 pr-4">string</td>
              <td className="py-2 pr-4">yes</td>
              <td className="py-2">Same as init</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">
                <Code>size</Code>
              </td>
              <td className="py-2 pr-4">integer</td>
              <td className="py-2 pr-4">yes</td>
              <td className="py-2">Exact file size in bytes</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">
                <Code>contentType</Code>
              </td>
              <td className="py-2 pr-4">string</td>
              <td className="py-2 pr-4">yes</td>
              <td className="py-2">Same as init</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">
                <Code>etag</Code>
              </td>
              <td className="py-2 pr-4">string</td>
              <td className="py-2 pr-4">yes</td>
              <td className="py-2">
                ETag from S3 PUT response (with or without quotes)
              </td>
            </tr>
            <tr>
              <td className="py-2 pr-4">
                <Code>ttl</Code>
              </td>
              <td className="py-2 pr-4">integer</td>
              <td className="py-2 pr-4">no</td>
              <td className="py-2">Same range as init</td>
            </tr>
          </tbody>
        </Table>

        <p className="mt-3 mb-1">
          <Strong>Response 200:</Strong>
        </p>
        <ApiBlock>{`{
  "shareToken": "A3K7",
  "shareUrl": "/d/A3K7",
  "fullUrl": "https://share.022025.xyz/d/A3K7",
  "expiresAt": 1783582870787
}`}</ApiBlock>
        <ul className="list-disc pl-6 mt-2 text-sm text-neutral-600 dark:text-neutral-400 space-y-1">
          <li>
            <Code>404</Code> — S3 object not found (URL expired or PUT
            incomplete).
          </li>
          <li>
            <Code>409</Code> — Size or ETag mismatch with S3.
          </li>
          <li>
            <Code>429</Code> — Rate limited or daily quota exceeded.
          </li>
          <li>
            Token format: 4 chars from <Code>[0-9A-Z]</Code>. On collision
            extends to 5 then 6.
          </li>
        </ul>

        {/* ── DOWNLOAD ── */}
        <Sub
          id="get-download"
          title={
            <>
              <Code>GET /api/download/:token</Code> — Download a file
            </>
          }
        />
        <Table>
          <thead>
            <tr className="border-b border-neutral-300 dark:border-neutral-700">
              <th className="text-left py-2 pr-4 font-medium">Query param</th>
              <th className="text-left py-2 font-medium">Effect</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">
                <em>(none)</em>
              </td>
              <td className="py-2">
                302 redirect to presigned S3 download URL
              </td>
            </tr>
            <tr>
              <td className="py-2 pr-4">
                <Code>?info=1</Code>
              </td>
              <td className="py-2">Return share metadata as JSON</td>
            </tr>
          </tbody>
        </Table>

        <p className="mt-3 mb-1">
          <Strong>
            With <Code>?info=1</Code>:
          </Strong>
        </p>
        <ApiBlock>{`{
  "filename": "photo.jpg",
  "size_bytes": 1048576,
  "content_type": "image/jpeg",
  "expires_at": 1783582870787,
  "download_count": 3
}`}</ApiBlock>

        <p className="mt-3 mb-1">
          <Strong>Without query param:</Strong> 302 redirect to presigned S3 GET
          URL (valid 300s).
        </p>

        {/* ── d/:token ── */}
        <Sub
          id="get-d-page"
          title={
            <>
              <Code>GET /d/:token</Code> — Human download page
            </>
          }
        />
        <p className="text-neutral-700 dark:text-neutral-300">
          Renders an HTML page with filename, size, expiry, and a download
          button.
        </p>

        {/* ── HEALTH ── */}
        <Sub
          id="get-health"
          title={
            <>
              <Code>GET /api/health</Code> — Health check
            </>
          }
        />
        <ApiBlock>{`{
  "status": "ok",
  "db": true,
  "s3": { "endpoint": "https://s3api.022025.xyz", "bucket": "cf-share", "region": "auto" },
  "limits": {
    "maxFileSize": "5368709120",
    "maxShareTtl": "604800",
    "maxDailyBytesPerIp": "5368709120",
    "maxDailyCountPerIp": "100"
  }
}`}</ApiBlock>

        <Hr />

        <Section id="limits" title="Limits &amp; Quotas" />
        <Table>
          <thead>
            <tr className="border-b border-neutral-300 dark:border-neutral-700">
              <th className="text-left py-2 pr-4 font-medium">Limit</th>
              <th className="text-left py-2 font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">Max file size</td>
              <td className="py-2">5 GB (5,368,709,120 bytes)</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">Min share TTL</td>
              <td className="py-2">1 hour (3,600 s)</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">Max share TTL</td>
              <td className="py-2">7 days (604,800 s)</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">Daily uploads per IP</td>
              <td className="py-2">5 GB</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">Daily file count per IP</td>
              <td className="py-2">100 files</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">Presigned PUT URL expiry</td>
              <td className="py-2">10 minutes (600 s)</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">Presigned GET URL expiry</td>
              <td className="py-2">5 minutes (300 s)</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">Allowed file types</td>
              <td className="py-2">Any (no restrictions)</td>
            </tr>
          </tbody>
        </Table>

        <Hr />

        <Section id="architecture" title="Architecture" />
        <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg p-4 font-mono text-xs leading-relaxed">
          <pre>{`┌──────────┐    PUT (presigned)     ┌──────────────┐
│  Browser  │ ──────────────────▶  │              │
│  or curl  │                      │   S3 Bucket  │
│           │ ◀──── 302 redirect ──│ (cf-share)   │
└────┬─────┘                      └──────────────┘
     │                                  ▲
     │ POST /api/upload/init             │
     │ POST /api/upload/complete         │ HeadObject / DeleteObject
     │ GET  /api/download/:token         │ (via AWS SDK)
     ▼                                  │
┌──────────┐                            │
│  Worker  │ ───────────────────────────┘
│ (Next.js)│
│          │ ─── D1 (shares/quota/audit)
└──────────┘
     │
     │ Scheduled (daily 03:00 UTC)
     ▼
┌──────────┐
│ Cleanup  │  Deletes expired S3 objects + D1 rows
└──────────┘`}</pre>
        </div>

        <ul className="list-disc pl-6 mt-4 text-sm text-neutral-600 dark:text-neutral-400 space-y-1">
          <li>The Worker never sees file bytes — uploads go direct to S3.</li>
          <li>
            Share tokens are random 4-char <Code>[0-9A-Z]</Code> codes.
          </li>
          <li>File data lives only in S3; D1 stores metadata.</li>
          <li>Expired shares garbage-collected daily at 03:00 UTC.</li>
        </ul>

        <Hr />

        <Section id="agent-tips" title="Agent Tips" />
        <ul className="list-disc pl-6 text-neutral-700 dark:text-neutral-300 space-y-2">
          <li>
            <Strong>No authentication.</Strong> All endpoints are public.
          </li>
          <li>
            <Strong>Stateless flow.</Strong> Each upload = init → PUT →
            complete.
          </li>
          <li>
            <Strong>Token collisions</Strong> handled automatically (length
            4→5→6).
          </li>
          <li>
            <Strong>Rate limits</Strong> per-IP. HTTP 429 on exceed.
          </li>
          <li>
            <Strong>Daily quotas</Strong> reset at 00:00 UTC.
          </li>
        </ul>

        <Hr />

        <Section id="example-python" title="Example: Python Agent" />
        <ApiBlock>{`import requests

BASE = "https://share.022025.xyz"

# 1. Init
resp = requests.post(f"{BASE}/api/upload/init", json={
    "filename": "report.pdf",
    "size": 500000,
    "contentType": "application/pdf",
    "ttl": 3600
})
init = resp.json()

# 2. PUT to S3
with open("report.pdf", "rb") as f:
    put_resp = requests.put(init["url"], data=f,
        headers={"Content-Type": "application/pdf"})
etag = put_resp.headers.get("etag", "").strip('"')

# 3. Complete
resp = requests.post(f"{BASE}/api/upload/complete", json={
    "uploadId": init["uploadId"],
    "key": init["key"],
    "filename": "report.pdf",
    "size": 500000,
    "contentType": "application/pdf",
    "etag": etag,
    "ttl": 3600
})
share = resp.json()
print(f"Share link: {share['fullUrl']}")`}</ApiBlock>

        <div className="mt-12 text-center text-sm text-neutral-500 dark:text-neutral-500">
          <a
            href="/"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            ← Back to upload
          </a>
        </div>
      </article>
    </main>
  );
}
