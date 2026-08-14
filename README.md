# cf-share

A minimal "share a file" web app on Cloudflare Workers + **SvelteKit**.
Files are **uploaded** directly to S3-compatible storage via presigned URLs —
the Worker never sees upload bytes. **Downloads** are authenticated 307 redirects
to short-lived presigned S3 URLs; file bytes do not pass through the Worker.

- **Production URL**: https://share.krsz.in (see `lib/config/app.ts`)
- **Worker URL**: https://cf-share.kurashizu123.workers.dev
- **Stack**: SvelteKit 5 + Vite + `@sveltejs/adapter-cloudflare` + Cloudflare D1
- **S3 endpoint**: https://s3api.022025.xyz (configured via `S3_ENDPOINT`)

## Limits

| Limit | Value |
|---|---|
| Max file size | 5 GB (anon), 100 GB (admin) |
| Min share TTL | 5 minutes |
| Max share TTL | 7 days |
| Default TTL | 24 hours |
| Per-IP daily upload | 20 GB total, 100 files |
| S3 pool total | 100 GB (across all active shares) |
| Token format | 4 alphanumeric chars (`[0-9A-Z]{4}`, extended to 5–6 on collision) |

## Routes

| Method | Path | Source | Purpose |
|--------|------|--------|---------|
| GET | `/` | `src/routes/+page.svelte` | Upload page (drag-and-drop) |
| GET | `/docs` | `src/routes/docs/+page.svelte` | API documentation |
| GET | `/admin` | `src/routes/admin/+page.svelte` | Admin panel (shares + audit log, JWT cookie) |
| GET | `/admin/login` | `src/routes/admin/login/+page.svelte` | Admin login form |
| GET | `/d/:token` | `src/routes/d/[token]/` | Download page (password prompt if protected) |
| GET | `/api/download/:token` | `src/routes/api/download/[token]/+server.ts` | Authenticate and redirect to a presigned S3 URL; `?info=1` for JSON metadata |
| POST | `/api/download/:token` | same | Verify password → return download URL |
| POST | `/api/upload/init` | `+server.ts` | Reserve a presigned PUT URL (single or multipart) |
| POST | `/api/upload/resume` | `+server.ts` | Re-sign missing multipart parts |
| POST | `/api/upload/complete` | `+server.ts` | Mint a share token |
| GET | `/api/health` | `+server.ts` | `{ status, db, s3, limits }` |
| GET/POST | `/api/admin/shares` | `+server.ts` | List shares (authenticated) |
| GET/POST | `/api/admin/audit` | `+server.ts` | List audit log (authenticated) |
| DELETE | `/api/admin/delete?token=X` | `+server.ts` | Delete a share (authenticated) |
| GET | `/api/admin/me` | `+server.ts` | Check whether the current session is authenticated |
| POST | `/api/admin/login` | `+server.ts` | Submit admin password, set `cf_admin` JWT cookie |
| POST | `/api/admin/logout` | `+server.ts` | Clear the `cf_admin` cookie |
| GET/POST | `/api/cron/cleanup` | `+server.ts` | Manual cleanup trigger (requires `CRON_SECRET`) |

## Admin Panel

The admin panel at `/admin` is protected by a password (`ADMIN_PASSWORD`)
which sets a short-lived JWT (`cf_admin` HttpOnly cookie, default 8h). The
cookie is automatically attached to every same-origin request — including
the upload flow's `init`/`complete` calls — so admin uploads work without
any extra client wiring. It provides three tabs:

- **Shares** — browse active/expired shares, search by filename or token, delete shares
- **Audit Log** — view all init/complete/download/delete events, filter by action type or IP
- **Upload** — upload a new file (admin path: 100 GB cap, no per-IP / per-pool quotas, optional `ttl=0` for "no expiry")

## Development

```bash
cp .dev.vars.example .dev.vars   # fill S3_* values + CRON_SECRET + ADMIN_*
npm ci
npm run dev                       # vite dev → SvelteKit, binds D1/ratelimit locally
npm run check                     # svelte-check typecheck
npm run s3:ping                   # verify S3 endpoint & credentials
```

The server code reads env via `event.platform.env` (SvelteKit + adapter-cloudflare),
not `getCloudflareContext()`. `lib/`, `database/schema.sql`, and
`scripts/` are shared unchanged.

## Database

```bash
# Apply schema locally
npm run db:migrate:local

# Apply schema to production D1
npm run db:migrate:remote
```

## Deployment

```bash
# One-time setup
npx wrangler d1 create cf-share-db         # paste database_id into wrangler.jsonc
npm run db:migrate:remote                  # apply database/schema.sql
npx wrangler secret put S3_ACCESS_KEY_ID
npx wrangler secret put S3_SECRET_ACCESS_KEY
npx wrangler secret put CRON_SECRET
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put ADMIN_JWT_SECRET   # e.g. openssl rand -hex 32

# Per-deploy
npm run deploy                             # vite build && wrangler deploy custom-worker.ts
```

`wrangler.jsonc`'s `main` is the adapter's build target (`build/worker.js`,
fetch-only). Deployment passes `custom-worker.ts` positionally: it imports the
generated worker and adds the `scheduled` handler for the cleanup cron. Static
assets are served via the `ASSETS` binding from `build/assets`.

### DNS (already configured)

```
CNAME  share  →  cf-share.kurashizu123.workers.dev  (proxied)
```

The authoritative hostname is `share.krsz.in` (see `lib/config/app.ts`
→ `APP_URL`). Update the DNS record above and the Cloudflare Worker's
"Custom Domains" setting when changing it.

## Architecture

```
Browser ──PUT──► S3 (presigned URL)
  │
  ├── POST /api/upload/init     ──► Worker ──► D1 (quota check)
  ├── POST /api/upload/complete ──► Worker ──► D1 (mint token)
  └── GET  /api/download/:token ──► Worker (auth + 307) ──► client ──► presigned S3 URL

Cleanup: cron (scheduled handler in custom-worker.ts) ──► D1 (find expired) ──► S3 (delete) ──► D1 (remove row)
```

## Gotchas

- **Downloads use an authenticated S3 redirect.** The download GET handler
  lives in `src/routes/api/download/[token]/+server.ts`. It performs the D1
  lookup, password gate, rate-limit check, and audit, then returns a short-lived
  `307` redirect to a presigned S3 URL. File bytes never pass through the
  Worker, so client disconnects close the S3 connection directly. There is no
  buffering, cache, or background origin read.

- **`lib/share/password.ts` uses Web Crypto** (SHA-256 + random salt), not
  Node `crypto`, so the auth path needs no `nodejs_compat` buffering.
- **AWS SDK DOM polyfills** are installed by `lib/s3/polyfill.ts`, imported at
  the top of `lib/s3/client.ts` (must run before any `S3Client` is built).
- **The cron `scheduled` handler is in `custom-worker.ts`**, not in SvelteKit:
  adapter-cloudflare only emits a `fetch` handler, so we wrap the generated
  worker and add `scheduled` → `runCleanup`.
- **Verifying changes:** direct presigned-S3 downloads are 100% reliable. Loop
  on a known-good share and require the response to keep `Content-Length` +
  full byte count + matching SHA-256 every time.

## See Also

- `AGENTS.md` — agent orientation (compact handoff)
- `/docs` — live API documentation page