<svelte:head>
	<title>API — Share</title>
	<meta name="description" content="KRSZ Share file sharing API docs." />
</svelte:head>

<script lang="ts">
	import { APP_URL, APP_HOST } from '@/lib/config/app';
</script>

<main class="min-h-screen bg-neutral-50 dark:bg-neutral-950 p-6">
	<article class="max-w-3xl mx-auto">
		<h1 class="text-4xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 mb-1">
			KRSZ Share API
		</h1>
		<p class="text-neutral-500 dark:text-neutral-400 mb-8">
			<a href={APP_URL} class="text-blue-600 dark:text-blue-400 hover:underline">{APP_HOST}</a>
			{" · "}Upload a file via presigned S3 URL, get a short-lived 4-char share link. Admin
			uploads bypass all quotas.
		</p>

		<!-- ── Anonymous Upload Flow ──────────────────────────────────────── -->
		<h2 class="text-2xl font-bold mt-10 mb-4 text-neutral-900 dark:text-neutral-50" id="upload">
			Upload Flow
		</h2>

		<h3 class="text-xl font-semibold mt-6 mb-3 text-neutral-800 dark:text-neutral-100">
			<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono"
				>POST /api/upload/init</code
			>
		</h3>
		<p class="text-sm text-neutral-600 dark:text-neutral-400 mb-3">
			Reserves an S3 presigned URL. Returns <code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">mode</code>{" "}
			(<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">"single"</code> ≤ 90 MB,
			<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">"multipart"</code> with{" "}
			<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">parts</code> array above). PUT
			URLs valid for 1 hour.
		</p>
		<div class="overflow-x-auto">
			<table class="w-full text-sm border-collapse">
				<thead>
					<tr class="border-b border-neutral-300 dark:border-neutral-700 text-left">
						<th class="py-2 pr-4 font-medium">Field</th>
						<th class="py-2 pr-4 font-medium">Type</th>
						<th class="py-2 font-medium">Note</th>
					</tr>
				</thead>
				<tbody>
					<tr class="border-b border-neutral-200 dark:border-neutral-800">
						<td class="py-2 pr-4"><code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">filename</code></td>
						<td class="py-2 pr-4">string</td>
						<td class="py-2">Required, ≤ 500 chars</td>
					</tr>
					<tr class="border-b border-neutral-200 dark:border-neutral-800">
						<td class="py-2 pr-4"><code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">size</code></td>
						<td class="py-2 pr-4">integer</td>
						<td class="py-2">1 – <strong>5 GB</strong> anon, <strong>100 GB</strong> admin</td>
					</tr>
					<tr class="border-b border-neutral-200 dark:border-neutral-800">
						<td class="py-2 pr-4"><code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">contentType</code></td>
						<td class="py-2 pr-4">string</td>
						<td class="py-2">MIME type</td>
					</tr>
					<tr class="border-b border-neutral-200 dark:border-neutral-800">
						<td class="py-2 pr-4"><code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">ttl</code></td>
						<td class="py-2 pr-4">integer</td>
						<td class="py-2">
							Anon: 300–604800s. Admin: same range, or{" "}
							<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">0</code> for “no expiry” (share
							lives ~100 years). Default 86400 (24h).
						</td>
					</tr>
					<tr class="border-b border-neutral-200 dark:border-neutral-800">
						<td class="py-2 pr-4"><code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">password</code></td>
						<td class="py-2 pr-4">string</td>
						<td class="py-2">Optional, 1–256 chars</td>
					</tr>
				</tbody>
			</table>
		</div>

		<h3 class="text-xl font-semibold mt-6 mb-3 text-neutral-800 dark:text-neutral-100">
			<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">PUT {"{url}"}</code> — Upload to S3
		</h3>
		<p class="text-sm text-neutral-600 dark:text-neutral-400 mb-2">
			Send file bytes directly to S3 via presigned URL. Capture the{" "}
			<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">ETag</code> header from the response for{" "}
			<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">/api/upload/complete</code>.
		</p>

		<h3 class="text-xl font-semibold mt-6 mb-3 text-neutral-800 dark:text-neutral-100">
			<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">POST /api/upload/resume</code> — Resume multipart
		</h3>
		<p class="text-sm text-neutral-600 dark:text-neutral-400 mb-2">
			If a multipart upload is interrupted (page refresh, network failure), call with{" "}
			<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">s3UploadId</code>,{" "}
			<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">key</code>,{" "}
			<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">size</code>, and{" "}
			<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">uploadedPartNumbers: number[]</code> to
			get fresh presigned URLs for the missing parts only. Client tracks uploaded parts in
			localStorage.
		</p>

		<h3 class="text-xl font-semibold mt-6 mb-3 text-neutral-800 dark:text-neutral-100">
			<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">POST /api/upload/complete</code>
		</h3>
		<p class="text-sm text-neutral-600 dark:text-neutral-400 mb-3">
			Finalizes the upload and mints a share token. Returns{" "}
			<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">{"{shareToken, shareUrl, fullUrl, proxyUrl, expiresAt}"}</code>.{" "}
			<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">proxyUrl</code> is non-null only for unprotected files at or below the{" "}
			<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">PROXY_MAX_FILE_SIZE</code> threshold (2 MiB by default).
		</p>
		<div class="overflow-x-auto">
			<table class="w-full text-sm border-collapse">
				<thead>
					<tr class="border-b border-neutral-300 dark:border-neutral-700 text-left">
						<th class="py-2 pr-4 font-medium">Field</th>
						<th class="py-2 font-medium">Note</th>
					</tr>
				</thead>
				<tbody>
					<tr class="border-b border-neutral-200 dark:border-neutral-800">
						<td class="py-2 pr-4"><code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">etag</code></td>
						<td class="py-2">Required for single mode (from PUT response)</td>
					</tr>
					<tr class="border-b border-neutral-200 dark:border-neutral-800">
						<td class="py-2 pr-4">
							<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">mode="multipart"</code>,{" "}
							<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">s3UploadId</code>,{" "}
							<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">parts</code>
						</td>
						<td class="py-2">
							Required for multipart mode. <code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">parts</code>:{" "}
							<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">[{"{partNumber, etag}"}]</code>
						</td>
					</tr>
					<tr>
						<td class="py-2 pr-4">Other fields</td>
						<td class="py-2">
							Same as init (<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">uploadId</code>,{" "}
							<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">key</code>,{" "}
							<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">filename</code>,{" "}
							<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">size</code>, etc.)
						</td>
					</tr>
				</tbody>
			</table>
		</div>

		<!-- ── Download ───────────────────────────────────────────────────── -->
		<h2 class="text-2xl font-bold mt-10 mb-4 text-neutral-900 dark:text-neutral-50" id="download">
			Download
		</h2>

		<h3 class="text-xl font-semibold mt-6 mb-3 text-neutral-800 dark:text-neutral-100">
			<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">GET /d/:token</code> — Download page (HTML)
		</h3>
		<p class="text-sm text-neutral-600 dark:text-neutral-400 mb-2">
			Renders a human-friendly download page with filename, size, and expiry countdown.
			Password-protected shares show a prompt.
		</p>

		<h3 class="text-xl font-semibold mt-6 mb-3 text-neutral-800 dark:text-neutral-100">
			<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">GET /api/download/:token</code> — Authenticate and redirect to S3
		</h3>
		<p class="text-sm text-neutral-600 dark:text-neutral-400 mb-2">
			After the share/password checks, the Worker returns a short-lived <code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">307</code> redirect to a presigned S3 URL. File bytes go directly from S3 to the client; Range headers are handled by S3. Append{" "}
			<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">?info=1</code> for JSON metadata or{" "}
			<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">?password=X</code> for protected shares.
		</p>

		<h3 class="text-xl font-semibold mt-6 mb-3 text-neutral-800 dark:text-neutral-100">
			<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">GET /p/:token</code> — Proxied small-file link
		</h3>
		<p class="text-sm text-neutral-600 dark:text-neutral-400 mb-2">
			Streams an unprotected file through the Worker when its size is at or below{" "}
			<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">PROXY_MAX_FILE_SIZE</code> (2 MiB by default). Supports byte-range requests. Password-protected and larger files return 404; use the normal download flow instead.
		</p>

		<h3 class="text-xl font-semibold mt-6 mb-3 text-neutral-800 dark:text-neutral-100">
			<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">POST /api/download/:token</code> — Password verification
		</h3>
		<p class="text-sm text-neutral-600 dark:text-neutral-400 mb-2">
			Body: <code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">{"{password: string}"}</code>. Returns{" "}
			<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">{"{verified: true, downloadUrl}"}</code>.
		</p>

		<!-- ── Admin ──────────────────────────────────────────────────────── -->
		<hr class="my-8 border-neutral-200 dark:border-neutral-800" />
		<h2 class="text-2xl font-bold mt-10 mb-4 text-neutral-900 dark:text-neutral-50" id="admin">
			Admin
		</h2>
		<p class="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
			Admin endpoints are protected by a short-lived JWT set as an{" "}
			<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">HttpOnly</code> cookie (
			<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">cf_admin</code>, default 8h). Log in once
			via the web panel at <code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">/admin/login</code>{" "}
			(entering the <code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">ADMIN_PASSWORD</code> secret) — the
			browser then attaches the cookie to every same-origin request, including
			<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">/api/upload/init</code> and{" "}
			<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">…/complete</code>. Admin uploads bypass{" "}
			<em>all</em> per-IP quotas and rate limits; the per-file cap is{" "}
			<strong>100 GB</strong> instead of 5 GB.
		</p>
		<div class="overflow-x-auto">
			<table class="w-full text-sm border-collapse">
				<thead>
					<tr class="border-b border-neutral-300 dark:border-neutral-700 text-left">
						<th class="py-2 pr-4 font-medium">Endpoint</th>
						<th class="py-2 font-medium">Purpose</th>
					</tr>
				</thead>
				<tbody>
					<tr class="border-b border-neutral-200 dark:border-neutral-800">
						<td class="py-2 pr-4"><code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">POST /api/admin/login</code></td>
						<td class="py-2">Body <code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">{"{password}"}</code>. Sets the <code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">cf_admin</code> cookie on success.</td>
					</tr>
					<tr class="border-b border-neutral-200 dark:border-neutral-800">
						<td class="py-2 pr-4"><code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">POST /api/admin/logout</code></td>
						<td class="py-2">Clears the <code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">cf_admin</code> cookie.</td>
					</tr>
					<tr class="border-b border-neutral-200 dark:border-neutral-800">
						<td class="py-2 pr-4"><code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">GET /api/admin/me</code></td>
						<td class="py-2">Returns <code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">{"{authenticated: true}"}</code> if the cookie is valid, otherwise 401.</td>
					</tr>
					<tr class="border-b border-neutral-200 dark:border-neutral-800">
						<td class="py-2 pr-4">
							<code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">POST /api/upload/init</code> + <code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">…/complete</code>
						</td>
						<td class="py-2">Same as anon; with a valid admin cookie the limits are lifted and <code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">ttl=0</code> is accepted.</td>
					</tr>
					<tr class="border-b border-neutral-200 dark:border-neutral-800">
						<td class="py-2 pr-4"><code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">GET /api/admin/shares?page=&q=&all=1</code></td>
						<td class="py-2">List shares with stats.</td>
					</tr>
					<tr class="border-b border-neutral-200 dark:border-neutral-800">
						<td class="py-2 pr-4"><code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">GET /api/admin/audit?apage=&aq=&aaction=</code></td>
						<td class="py-2">Audit log.</td>
					</tr>
					<tr class="border-b border-neutral-200 dark:border-neutral-800">
						<td class="py-2 pr-4"><code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">DELETE /api/admin/delete?token=X</code></td>
						<td class="py-2">Delete a share.</td>
					</tr>
					<tr>
						<td class="py-2 pr-4"><code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">GET /admin</code></td>
						<td class="py-2">Web admin panel (Shares + Audit Log + Upload tabs).</td>
					</tr>
				</tbody>
			</table>
		</div>

		<!-- ── Limits ─────────────────────────────────────────────────────── -->
		<hr class="my-8 border-neutral-200 dark:border-neutral-800" />
		<h2 class="text-2xl font-bold mt-10 mb-4 text-neutral-900 dark:text-neutral-50" id="limits">
			Limits
		</h2>
		<div class="overflow-x-auto">
			<table class="w-full text-sm border-collapse">
				<thead>
					<tr class="border-b border-neutral-300 dark:border-neutral-700 text-left">
						<th class="py-2 pr-4 font-medium">Limit</th>
						<th class="py-2 font-medium">Value</th>
					</tr>
				</thead>
				<tbody>
					<tr class="border-b border-neutral-200 dark:border-neutral-800">
						<td class="py-2 pr-4">Max file (anonymous)</td>
						<td class="py-2">5 GB</td>
					</tr>
					<tr class="border-b border-neutral-200 dark:border-neutral-800">
						<td class="py-2 pr-4">Max file (admin)</td>
						<td class="py-2">100 GB</td>
					</tr>
					<tr class="border-b border-neutral-200 dark:border-neutral-800">
						<td class="py-2 pr-4">TTL range</td>
						<td class="py-2">5 min – 7 days (default 24 h). Admin may send <code class="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono">0</code> for “no expiry”.</td>
					</tr>
					<tr class="border-b border-neutral-200 dark:border-neutral-800">
						<td class="py-2 pr-4">Per-IP daily (anon)</td>
						<td class="py-2">20 GB / 100 files</td>
					</tr>
					<tr class="border-b border-neutral-200 dark:border-neutral-800">
						<td class="py-2 pr-4">S3 pool total</td>
						<td class="py-2">100 GB (all active shares)</td>
					</tr>
					<tr class="border-b border-neutral-200 dark:border-neutral-800">
						<td class="py-2 pr-4">Presigned PUT expiry</td>
						<td class="py-2">1 hour</td>
					</tr>
					<tr class="border-b border-neutral-200 dark:border-neutral-800">
						<td class="py-2 pr-4">Presigned GET expiry</td>
						<td class="py-2">Remaining share TTL, capped at 7 days by S3 SigV4. Admin “no expiry” shares receive a maximum 7-day URL.</td>
					</tr>
					<tr>
						<td class="py-2 pr-4">Rate limits (anon, 60s)</td>
						<td class="py-2">30 init / 30 complete / 60 download / 30 lookup</td>
					</tr>
				</tbody>
			</table>
		</div>

		<!-- ── Quick start ─────────────────────────────────────────────────── -->
		<hr class="my-8 border-neutral-200 dark:border-neutral-800" />
		<h2 class="text-2xl font-bold mt-10 mb-4 text-neutral-900 dark:text-neutral-50" id="quickstart">
			Quick start (cURL)
		</h2>
		<pre class="bg-neutral-900 dark:bg-black text-neutral-100 p-4 rounded-lg overflow-x-auto text-sm leading-relaxed"><code>{`# 1. Init
INIT=$(curl -fsS -X POST "${APP_URL}/api/upload/init" \\
  -H "Content-Type: application/json" \\
  -d '{"filename":"photo.jpg","size":1048576,"contentType":"image/jpeg","ttl":86400}')
URL=$(echo "$INIT" | sed -n 's/.*"url":"\\([^"]*\\)".*/\\1/p')
KEY=$(echo "$INIT" | sed -n 's/.*"key":"\\([^"]*\\)".*/\\1/p')
UID=$(echo "$INIT" | sed -n 's/.*"uploadId":"\\([^"]*\\)".*/\\1/p')

# 2. PUT to S3 (capture ETag)
ETAG=$(curl -fsS -X PUT "$URL" -H "Content-Type: image/jpeg" \\
  --data-binary "@photo.jpg" -D - | tr -d '\\r' | awk 'tolower($1)=="etag:"{gsub(/"/,"",$2); print $2}')

# 3. Complete
curl -fsS -X POST "${APP_URL}/api/upload/complete" \\
  -H "Content-Type: application/json" \\
  -d "{\\"uploadId\\":\\"$UID\\",\\"key\\":\\"$KEY\\",\\"filename\\":\\"photo.jpg\\",\\"size\\":1048576,\\"contentType\\":\\"image/jpeg\\",\\"etag\\":\\"$ETAG\\",\\"ttl\\":86400}"

# 4. Download
curl -fsSL "${APP_URL}/d/ABCD" -o downloaded-file`}</code></pre>

		<div class="mt-12 text-center text-sm text-neutral-500 dark:text-neutral-500">
			<a href="/" class="text-blue-600 dark:text-blue-400 hover:underline">← Back to upload</a>
			{" · "}
			<a href="/admin" class="text-blue-600 dark:text-blue-400 hover:underline">Admin</a>
		</div>
	</article>
</main>
