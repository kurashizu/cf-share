# cf-share

A minimal "share a file" web app on Cloudflare Workers + OpenNext + Next.js.
Files are **uploaded** directly to S3-compatible storage via presigned URLs —
the Worker never sees upload bytes. **Downloads** are streamed natively in the
worker (`custom-worker.ts`), not via a Next.js route handler.

- **Production URL**: https://share.krsz.in (see `lib/config/app.ts`)
- **Worker URL**: https://cf-share.kurashizu123.workers.dev
- **Stack**: Next.js 16 + React 19 + @opennextjs/cloudflare + Cloudflare D1
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

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Upload page (drag-and-drop) |
| GET | `/docs` | API documentation for agent use |
| GET | `/admin` | Admin panel (shares + audit log, JWT cookie) |
| GET | `/admin/login` | Admin login form |
| GET | `/d/:token` | Download page (with password prompt if protected) |
| GET | `/api/download/:token` | Stream file bytes from S3 (native worker proxy in `custom-worker.ts`, supports Range); add `?info=1` for JSON metadata |
| POST | `/api/download/:token` | Verify password → return download URL |
| POST | `/api/upload/init` | Reserve a presigned PUT URL (single or multipart) |
| POST | `/api/upload/complete` | Mint a share token |
| GET | `/api/health` | `{ status, db, s3, limits }` |
| GET/POST | `/api/admin/shares` | List shares (authenticated) |
| GET/POST | `/api/admin/audit` | List audit log (authenticated) |
| DELETE | `/api/admin/delete?token=X` | Delete a share (authenticated) |
| GET | `/api/admin/me` | Check whether the current session is authenticated |
| POST | `/api/admin/login` | Submit admin password, set `cf_admin` JWT cookie |
| POST | `/api/admin/logout` | Clear the `cf_admin` cookie |
| GET/POST | `/api/cron/cleanup` | Manual cleanup trigger (requires `CRON_SECRET`) |

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
cp .dev.vars.example .dev.vars   # fill S3_* values + CRON_SECRET
npm ci --legacy-peer-deps
npm run dev                       # next dev on :3000
npm run preview                   # wrangler dev (workerd runtime, accurate)
npm run s3:ping                   # verify S3 endpoint & credentials
```

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
npm run deploy                             # builds + deploys
```

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
  └── GET  /api/download/:token ──► Worker (custom-worker.ts, native) ──► D1 (lookup) ──► presigned S3 GET ──► stream to client

Cleanup: cron every 30 min ──► Worker ──► D1 (find expired) ──► S3 (delete) ──► D1 (remove row)
```

## Gotchas

- **Downloads must be streamed at the native Worker layer, not in a Next.js
  route handler.** The download GET proxy lives in `custom-worker.ts`
  (`handleDownloadGet`), which fetches S3 and returns `new Response(upstream.body)`
  directly. If you instead proxy inside `app/api/download/[token]/route.ts`, the
  response travels through OpenNext's Next-node-server pipeline — it drops the
  `Content-Length` and truncates the HTTP/2 stream randomly (same URL returns 0
  / partial / full bytes) regardless of how the body is built (direct,
  TransformStream, or arrayBuffer). The Next route GET is kept only as a
  `Response.redirect(dlUrl, 302)` fallback (which works, but bypasses the proxy).
- **`runtime = "edge"` is NOT usable for route handlers here.** The download
  route must stay `runtime = "nodejs"`. With `edge`, OpenNext `1.19.9` fails
  to load the app-route component (`interopDefault` / `findPageComponentsImpl`
  → 500 "Internal Server Error").
- **Verifying changes:** direct-S3 (presigned) downloads are 100% reliable;
  any regressions in the proxy show up as < expected byte count. Loop on a
  known-good share and require the response to keep `Content-Length` + full byte
  count every time.

## See Also

- `AGENTS.md` — agent orientation (compact handoff for AI coding agents)
- `/docs` — live API documentation page
