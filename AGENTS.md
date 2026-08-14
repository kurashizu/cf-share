# AGENTS.md

Agent orientation for `cf-share`.

## Project

Minimal file-sharing web app. Visitors upload a single file and receive a
short-lived download link. No login required.

**Stack: SvelteKit 5 + `@sveltejs/adapter-cloudflare`** (the server compiles
straight to a Cloudflare Worker with no node-server bridge).

Live at https://share.krsz.in (see `lib/config/app.ts` for the authoritative value)

## Routes

All pages in `src/routes/…/+page.svelte`, all APIs in `src/routes/…/+server.ts`.
Env is read via `event.platform.env` (see `src/app.d.ts` for `App.Platform`).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Upload page (drag-and-drop) |
| GET | `/docs` | API documentation |
| GET | `/admin` | Admin panel (JWT cookie set at `/admin/login`) |
| GET | `/admin/login` | Admin login form |
| GET | `/d/:token` | Download page (HTML) |
| GET | `/api/download/:token` | Authenticate and redirect to a presigned S3 URL (`?info=1` returns metadata) |
| GET | `/p/:token` | Proxy an unprotected file through the Worker when at or below `PROXY_MAX_FILE_SIZE` |
| POST | `/api/download/:token` | Password verification |
| POST | `/api/upload/init` | Reserve presigned PUT URL (admin auth skips all quotas) |
| POST | `/api/upload/resume` | Re-sign missing parts for interrupted multipart upload |
| POST | `/api/upload/complete` | Mint share token |
| GET | `/api/health` | Health check |
| GET/POST | `/api/cron/cleanup` | Manual cleanup trigger (`X-Cron-Secret`) |
| GET/POST | `/api/admin/shares` | List shares (auth) |
| GET/POST | `/api/admin/audit` | Audit log (auth) |
| DELETE | `/api/admin/delete` | Delete share (auth) |
| POST | `/api/admin/login` | Submit password, set `cf_admin` JWT cookie |
| POST | `/api/admin/logout` | Clear `cf_admin` cookie |
| GET | `/api/admin/me` | Auth check (returns 401 if no/invalid cookie) |

## D1 Database

Schema in `database/schema.sql`.

| Table | Purpose |
|-------|---------|
| `shares` | Share tokens, S3 keys, TTL, password hash |
| `upload_quota` | Per-IP daily byte/count totals |
| `audit_log` | All init/complete/download/expire/delete events |

## S3 Storage

Single bucket (`cf-share`) on `s3api.022025.xyz` (see `lib/config/app.ts` → `S3_PUBLIC_ENDPOINT`).
Key layout: `uploads/{YYYY}/{MM}/{DD}/{share-token}/{filename}`

All uploads go direct to S3 via presigned URL — Worker never sees upload
bytes. Multipart upload used for files > 90 MB (50 MB parts).

Normal downloads are authenticated redirects in `src/routes/api/download/[token]/+server.ts`:
look up the share in D1, perform the password gate and audit, then return a
short-lived 307 redirect to the presigned S3 URL. Small, unprotected files
also have a `/p/:token` Worker-proxied link limited by `PROXY_MAX_FILE_SIZE`;
that route streams the S3 body without buffering.

## Limits

- Max file: 5 GB (anon), 100 GB (admin via JWT cookie)
- TTL: 5 min to 7 days (default 24h)
- Per-IP daily: 20 GB / 100 files (admin bypasses)
- S3 pool: 100 GB total (admin bypasses)
- Proxied link threshold: 2 MiB by default (`PROXY_MAX_FILE_SIZE`), unprotected files only
- Rate limits: 30 init / 30 complete / 60 download / 30 lookup per 60s (admin bypasses)
- Presigned PUT URL TTL: 1 hour (multipart uploads for large files)
- Presigned GET URL TTL: remaining share TTL, capped at 7 days by SigV4
- Resume: client tracks parts in localStorage, calls `/api/upload/resume` to re-sign missing parts

## Token Format

4 chars `[0-9A-Z]` (1,679,616 combos). Collisions extend to 5 then 6 chars.
See `lib/share/token.ts`.

## Key Files

- `src/lib/Uploader.svelte` (+ `FileItem.svelte`, `ResultPanel.svelte`, `client/resume.ts`) — upload UI
- `src/lib/DownloadPage.svelte` — `/d/:token` page component
- `src/routes/admin/+page.svelte` — admin panel (shares/audit/upload tabs)
- `lib/s3/` — S3 client, presign, multipart, cleanup, policy, polyfill
- `lib/share/` — Token gen, password hash (Web Crypto), D1 store
- `lib/admin/auth.ts` — JWT sign/verify for admin sessions (`cf_admin` cookie)
- `custom-worker.ts` — adapter-cloudflare wrapper: re-exports the generated
  worker's `fetch` + adds the `scheduled` cron handler (→ `runCleanup`)
- `wrangler.jsonc` — bindings/vars; `main` = adapter build target
  (`build/worker.js`), deploy uses `custom-worker.ts` positionally

## Common Commands

```bash
npm run dev              # vite dev (SvelteKit, local D1/bindings)
npm run check            # svelte-check typecheck
npm run build            # vite build → build/worker.js + build/assets
npm run deploy           # vite build && wrangler deploy custom-worker.ts
npm run cf-typegen       # regenerate cloudflare-env.d.ts
npm run s3:ping          # test S3 endpoint & creds
npm run db:migrate:remote
```

## Conventions

- All UI in English, TypeScript strict mode, Tailwind 4.
- Server-side validation on every API route; never trust the client.
- All S3 interactions go through `lib/s3/*` — no scattered `S3Client` instances.
- Normal downloading uses the authenticated 307 redirect in
  `src/routes/api/download/[token]/+server.ts`; password verification happens
  before the redirect. The separate `/p/:token` route may proxy only
  unprotected files at or below `PROXY_MAX_FILE_SIZE`, and must stream without
  buffering, caching, or background reads.
- Env: use `event.platform.env`; the application runs on adapter-cloudflare.
