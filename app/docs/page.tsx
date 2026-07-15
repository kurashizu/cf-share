import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "API — Share",
  description: "cf-share file sharing API docs.",
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
          {" · "}Upload a file via presigned S3 URL, get a short-lived 4-char
          share link. Admin uploads bypass all quotas.
        </p>

        {/* ── Anonymous Upload Flow ──────────────────────────────────────── */}
        <h2
          className="text-2xl font-bold mt-10 mb-4 text-neutral-900 dark:text-neutral-50"
          id="upload"
        >
          Upload Flow
        </h2>

        <h3 className="text-xl font-semibold mt-6 mb-3 text-neutral-800 dark:text-neutral-100">
          <Code>POST /api/upload/init</Code>
        </h3>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-3">
          Reserves an S3 presigned URL. Returns <Code>mode</Code>{" "}
          (<Code>"single"</Code> ≤ 90 MB, <Code>"multipart"</Code> with{" "}
          <Code>parts</Code> array above). PUT URLs valid for 1 hour.
        </p>
        <Table>
          <thead>
            <tr className="border-b border-neutral-300 dark:border-neutral-700 text-left">
              <th className="py-2 pr-4 font-medium">Field</th>
              <th className="py-2 pr-4 font-medium">Type</th>
              <th className="py-2 font-medium">Note</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4"><Code>filename</Code></td>
              <td className="py-2 pr-4">string</td>
              <td className="py-2">Required, ≤ 500 chars</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4"><Code>size</Code></td>
              <td className="py-2 pr-4">integer</td>
              <td className="py-2">
                1 – <strong>5 GB</strong> anon, <strong>100 GB</strong> admin
              </td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4"><Code>contentType</Code></td>
              <td className="py-2 pr-4">string</td>
              <td className="py-2">MIME type</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4"><Code>ttl</Code></td>
              <td className="py-2 pr-4">integer</td>
              <td className="py-2">300–604800s, default 86400</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4"><Code>password</Code></td>
              <td className="py-2 pr-4">string</td>
              <td className="py-2">Optional, 1–256 chars</td>
            </tr>
          </tbody>
        </Table>

        <h3 className="text-xl font-semibold mt-6 mb-3 text-neutral-800 dark:text-neutral-100">
          <Code>PUT {"{url}"}</Code> — Upload to S3
        </h3>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-2">
          Send file bytes directly to S3 via presigned URL. Capture the{" "}
          <Code>ETag</Code> header from the response for{" "}
          <Code>/api/upload/complete</Code>.
        </p>

        <h3 className="text-xl font-semibold mt-6 mb-3 text-neutral-800 dark:text-neutral-100">
          <Code>POST /api/upload/resume</Code> — Resume multipart
        </h3>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-2">
          If a multipart upload is interrupted (page refresh, network failure),
          call with <Code>s3UploadId</Code>, <Code>key</Code>,{" "}
          <Code>size</Code>, and <Code>uploadedPartNumbers: number[]</Code> to
          get fresh presigned URLs for the missing parts only. Client tracks
          uploaded parts in localStorage.
        </p>

        <h3 className="text-xl font-semibold mt-6 mb-3 text-neutral-800 dark:text-neutral-100">
          <Code>POST /api/upload/complete</Code>
        </h3>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-3">
          Finalizes the upload and mints a share token. Returns{" "}
          <Code>{"{shareToken, shareUrl, fullUrl, expiresAt}"}</Code>.
        </p>
        <Table>
          <thead>
            <tr className="border-b border-neutral-300 dark:border-neutral-700 text-left">
              <th className="py-2 pr-4 font-medium">Field</th>
              <th className="py-2 font-medium">Note</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4"><Code>etag</Code></td>
              <td className="py-2">Required for single mode (from PUT response)</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">
                <Code>mode="multipart"</Code>, <Code>s3UploadId</Code>,{" "}
                <Code>parts</Code>
              </td>
              <td className="py-2">
                Required for multipart mode. <Code>parts</Code>:{" "}
                <Code>[{"{partNumber, etag}"}]</Code>
              </td>
            </tr>
            <tr>
              <td className="py-2 pr-4">Other fields</td>
              <td className="py-2">
                Same as init (<Code>uploadId</Code>, <Code>key</Code>,{" "}
                <Code>filename</Code>, <Code>size</Code>, etc.)
              </td>
            </tr>
          </tbody>
        </Table>

        {/* ── Download ───────────────────────────────────────────────────── */}
        <h2
          className="text-2xl font-bold mt-10 mb-4 text-neutral-900 dark:text-neutral-50"
          id="download"
        >
          Download
        </h2>

        <h3 className="text-xl font-semibold mt-6 mb-3 text-neutral-800 dark:text-neutral-100">
          <Code>GET /d/:token</Code> — Download page (HTML)
        </h3>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-2">
          Renders a human-friendly download page with filename, size, and
          expiry countdown. Password-protected shares show a prompt.
        </p>

        <h3 className="text-xl font-semibold mt-6 mb-3 text-neutral-800 dark:text-neutral-100">
          <Code>GET /api/download/:token</Code> — Presigned S3 URL
        </h3>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-2">
          302 redirect to a presigned S3 GET URL (valid 300s). Append{" "}
          <Code>?info=1</Code> for JSON metadata or <Code>?password=X</Code>{" "}
          for protected shares.
        </p>

        <h3 className="text-xl font-semibold mt-6 mb-3 text-neutral-800 dark:text-neutral-100">
          <Code>POST /api/download/:token</Code> — Password verification
        </h3>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-2">
          Body: <Code>{"{password: string}"}</Code>. Returns{" "}
          <Code>{"{verified: true, downloadUrl}"}</Code>.
        </p>

        {/* ── Admin ──────────────────────────────────────────────────────── */}
        <Hr />
        <h2
          className="text-2xl font-bold mt-10 mb-4 text-neutral-900 dark:text-neutral-50"
          id="admin"
        >
          Admin
        </h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
          All admin endpoints require <Code>Authorization: Basic …</Code> using
          the S3 access credentials. Admin uploads bypass{" "}
          <em>all</em> per-IP quotas and rate limits; the per-file cap is{" "}
          <strong>100 GB</strong> instead of 5 GB.
        </p>
        <ul className="list-disc pl-6 text-sm text-neutral-600 dark:text-neutral-400 space-y-1 mb-4">
          <li>
            <Code>POST /api/upload/init</Code> + <Code>…/complete</Code> —
            Upload with Basic auth for admin privileges
          </li>
          <li>
            <Code>GET /api/admin/shares?page=&amp;q=&amp;all=1</Code> — List
            shares with stats
          </li>
          <li>
            <Code>GET /api/admin/audit?page=&amp;action=</Code> — Audit log
          </li>
          <li>
            <Code>DELETE /api/admin/delete?token=X</Code> — Delete a share
          </li>
          <li>
            <Code>GET /admin</Code> — Web admin panel (Shares + Audit tabs)
          </li>
        </ul>

        {/* ── Limits ─────────────────────────────────────────────────────── */}
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
              <td className="py-2 pr-4">Max file (anonymous)</td>
              <td className="py-2">5 GB</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">Max file (admin)</td>
              <td className="py-2">100 GB</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">TTL range</td>
              <td className="py-2">5 min – 7 days (default 24 h)</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">Per-IP daily (anon)</td>
              <td className="py-2">20 GB / 100 files</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">S3 pool total</td>
              <td className="py-2">100 GB (all active shares)</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">Presigned PUT expiry</td>
              <td className="py-2">1 hour</td>
            </tr>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-4">Presigned GET expiry</td>
              <td className="py-2">5 min</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">Rate limits (anon, 60s)</td>
              <td className="py-2">
                30 init / 30 complete / 60 download / 30 lookup
              </td>
            </tr>
          </tbody>
        </Table>

        {/* ── Quick start ─────────────────────────────────────────────────── */}
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
ETAG=$(curl -fsS -X PUT "$URL" -H "Content-Type: image/jpeg" \\
  --data-binary "@photo.jpg" -D - | tr -d '\\r' | awk 'tolower($1)=="etag:"{gsub(/"/,"",$2); print $2}')

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
