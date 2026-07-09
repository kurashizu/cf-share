import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "API — Share",
  description: "cf-share anonymous file sharing API docs.",
  robots: { index: false, follow: false },
};

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

export default function DocsPage() {
  return (
    <main className="min-h-screen bg-neutral-50 dark:bg-neutral-950 p-6">
      <article className="max-w-3xl mx-auto">
        <h1 className="text-4xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 mb-1">
          cf-share API
        </h1>
        <p className="text-neutral-500 dark:text-neutral-400 mb-8">
          <a
            href="https://share.022025.xyz"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            share.022025.xyz
          </a>
          {" · "}Anonymous file sharing. Upload via presigned S3 URL, get a
          4-char share link.
        </p>

        <h2
          className="text-2xl font-bold mt-10 mb-4 text-neutral-900 dark:text-neutral-50"
          id="endpoints"
        >
          Endpoints
        </h2>

        <h3 className="text-xl font-semibold mt-6 mb-3 text-neutral-800 dark:text-neutral-100">
          <Code>POST /api/upload/init</Code> — Reserve upload URL
        </h3>
        <Table>
          <thead>
            <tr className="border-b border-neutral-300 dark:border-neutral-700 text-left">
              <th className="py-2 pr-4 font-medium">Field</th>
              <th className="py-2 pr-4 font-medium">Type</th>
              <th className="py-2 font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">
                <Code>filename</Code>
              </td>
              <td className="py-2 pr-4">string</td>
              <td className="py-2">Required. Max 500 chars.</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">
                <Code>size</Code>
              </td>
              <td className="py-2 pr-4">integer</td>
              <td className="py-2">Required. 1 – 5,368,709,120 bytes.</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">
                <Code>contentType</Code>
              </td>
              <td className="py-2 pr-4">string</td>
              <td className="py-2">Required. MIME type.</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">
                <Code>ttl</Code>
              </td>
              <td className="py-2 pr-4">integer</td>
              <td className="py-2">
                Optional. 300–604800s. Default: 86400 (24h).
              </td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">
                <Code>password</Code>
              </td>
              <td className="py-2 pr-4">string</td>
              <td className="py-2">
                Optional. Password-protect the share (1-256 chars).
              </td>
            </tr>
          </tbody>
        </Table>
        <p className="mt-2 text-sm text-neutral-500">
          Returns <Code>uploadId</Code>, <Code>key</Code>, <Code>url</Code>{" "}
          (presigned PUT, 10min valid), and <Code>mode</Code> (
          <Code>"single"</Code> for small files, <Code>"multipart"</Code> with{" "}
          <Code>parts</Code> array for large files).
        </p>

        <h3 className="text-xl font-semibold mt-6 mb-3 text-neutral-800 dark:text-neutral-100">
          <Code>PUT {"{url}"}</Code> — Upload to S3
        </h3>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-2">
          Send file body bytes directly to S3 with the presigned URL. For single
          mode, set <Code>Content-Type</Code> from init response. Multipart
          parts need no headers. Capture the <Code>ETag</Code> response header.
        </p>

        <h3 className="text-xl font-semibold mt-6 mb-3 text-neutral-800 dark:text-neutral-100">
          <Code>POST /api/upload/complete</Code> — Mint share token
        </h3>
        <Table>
          <thead>
            <tr className="border-b border-neutral-300 dark:border-neutral-700 text-left">
              <th className="py-2 pr-4 font-medium">Field</th>
              <th className="py-2 pr-4 font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">
                <Code>
                  uploadId, key, filename, size, contentType, ttl, password
                </Code>
              </td>
              <td className="py-2">Same as init.</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">
                <Code>etag</Code>
              </td>
              <td className="py-2">
                Required for single mode. From S3 PUT response.
              </td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">
                <Code>mode</Code> = <Code>"multipart"</Code>,{" "}
                <Code>s3UploadId</Code>, <Code>parts</Code>
              </td>
              <td className="py-2">
                Required for multipart mode. Array of{" "}
                <Code>{"{partNumber, etag}"}</Code>.
              </td>
            </tr>
          </tbody>
        </Table>
        <p className="mt-2 text-sm text-neutral-500">
          Returns <Code>{"{shareToken, shareUrl, fullUrl, expiresAt}"}</Code>.
          Token is 4 chars <Code>[0-9A-Z]</Code> (extends to 5–6 on collision).
        </p>

        <h3 className="text-xl font-semibold mt-6 mb-3 text-neutral-800 dark:text-neutral-100">
          <Code>GET /api/download/:token</Code> — Download
        </h3>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-2">
          Without query: 302 redirect to presigned S3 GET URL (valid 300s).
          <br />
          <Code>?info=1</Code> — Returns JSON metadata (<Code>filename</Code>,{" "}
          <Code>size_bytes</Code>, <Code>expires_at</Code>,{" "}
          <Code>has_password</Code>).
          <br />
          <Code>?password=X</Code> — Provide password for protected shares.
        </p>

        <h3 className="text-xl font-semibold mt-6 mb-3 text-neutral-800 dark:text-neutral-100">
          <Code>POST /api/download/:token</Code> — Password verification
        </h3>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-2">
          Body: <Code>{"{password: string}"}</Code>. Returns{" "}
          <Code>{"{verified: true, downloadUrl}"}</Code> on success, 401 on
          wrong password.
        </p>

        <h3 className="text-xl font-semibold mt-6 mb-3 text-neutral-800 dark:text-neutral-100">
          <Code>GET /api/health</Code> — Health check
        </h3>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-2">
          Returns <Code>{"{status, db, s3, limits}"}</Code>.
        </p>

        <h3 className="text-xl font-semibold mt-6 mb-3 text-neutral-800 dark:text-neutral-100">
          Admin endpoints (HTTP Basic Auth, S3 credentials)
        </h3>
        <ul className="list-disc pl-6 text-sm text-neutral-600 dark:text-neutral-400 space-y-1 mb-4">
          <li>
            <Code>GET /api/admin/shares?page=&amp;q=&amp;all=1</Code> — List
            shares with stats
          </li>
          <li>
            <Code>GET /api/admin/audit?apage=&amp;aq=&amp;aaction=</Code> —
            Audit log
          </li>
          <li>
            <Code>DELETE /api/admin/delete?token=X</Code> — Delete a share
          </li>
          <li>
            <Code>GET /admin</Code> — Web admin panel (Shares + Audit tabs)
          </li>
        </ul>

        <h3 className="text-xl font-semibold mt-6 mb-3 text-neutral-800 dark:text-neutral-100">
          <Code>GET /d/:token</Code> — Download page (HTML)
        </h3>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-2">
          Renders a human-friendly download page with filename, size, expiry
          countdown, and download button. Password-protected shares show a
          password prompt.
        </p>

        <Hr />

        <h2
          className="text-2xl font-bold mt-10 mb-4 text-neutral-900 dark:text-neutral-50"
          id="limits"
        >
          Limits
        </h2>
        <Table>
          <thead>
            <tr className="border-b border-neutral-300 dark:border-neutral-700 text-left">
              <th className="py-2 pr-4 font-medium">Limit</th>
              <th className="py-2 font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">Max file size</td>
              <td className="py-2">5 GB</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">TTL range</td>
              <td className="py-2">5 min – 7 days</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">Default TTL</td>
              <td className="py-2">24 hours</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">Per-IP daily upload</td>
              <td className="py-2">10 GB total / 100 files</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">S3 pool total</td>
              <td className="py-2">100 GB (all active shares)</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">Presigned PUT expiry</td>
              <td className="py-2">10 min</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">Presigned GET expiry</td>
              <td className="py-2">5 min</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">File types</td>
              <td className="py-2">Any (no restrictions)</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">Rate limits (per IP, 60s window)</td>
              <td className="py-2">
                30 init / 30 complete / 60 download / 30 lookup
              </td>
            </tr>
          </tbody>
        </Table>

        <Hr />

        <h2
          className="text-2xl font-bold mt-10 mb-4 text-neutral-900 dark:text-neutral-50"
          id="quickstart"
        >
          Quick start (cURL)
        </h2>
        <ApiBlock>{`# 1. Init
INIT=$(curl -fsS -X POST "https://share.022025.xyz/api/upload/init" \\
  -H "Content-Type: application/json" \\
  -d '{"filename":"photo.jpg","size":1048576,"contentType":"image/jpeg","ttl":86400}')
URL=$(echo "$INIT" | sed -n 's/.*"url":"\\([^"]*\\)".*/\\1/p')
KEY=$(echo "$INIT" | sed -n 's/.*"key":"\\([^"]*\\)".*/\\1/p')
UID=$(echo "$INIT" | sed -n 's/.*"uploadId":"\\([^"]*\\)".*/\\1/p')

# 2. PUT to S3 (capture ETag)
ETAG=$(curl -fsS -X PUT "$URL" -H "Content-Type: image/jpeg" --data-binary "@photo.jpg" \\
  -D - | tr -d '\\r' | awk 'tolower($1)=="etag:" {gsub(/"/,"",$2); print $2}')

# 3. Complete
curl -fsS -X POST "https://share.022025.xyz/api/upload/complete" \\
  -H "Content-Type: application/json" \\
  -d "{\\"uploadId\\":\\"$UID\\",\\"key\\":\\"$KEY\\",\\"filename\\":\\"photo.jpg\\",\\"size\\":1048576,\\"contentType\\":\\"image/jpeg\\",\\"etag\\":\\"$ETAG\\",\\"ttl\\":86400}"

# 4. Download
curl -fsSL "https://share.022025.xyz/d/ABCD" -o downloaded-file`}</ApiBlock>

        <div className="mt-12 text-center text-sm text-neutral-500 dark:text-neutral-500">
          <a
            href="/"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            ← Back to upload
          </a>
          {" · "}
          <a
            href="/admin"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            Admin
          </a>
        </div>
      </article>
    </main>
  );
}
