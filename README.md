# cf-share

A minimal "share a file" web app on Cloudflare Workers + OpenNext + Next.js.
Files go directly to S3-compatible storage via presigned URLs — the Worker
never proxies file bodies.

- **Production URL**: https://share.022025.xyz
- **Worker URL**: https://cf-share.kurashizu123.workers.dev
- **Stack**: Next.js 16 + React 19 + @opennextjs/cloudflare + Cloudflare D1
- **S3 endpoint**: https://s3api.022025.xyz (configured via `S3_ENDPOINT`)

## Limits

| Limit | Value |
|---|---|
| Max file size | 10 GB |
| Min share TTL | 5 minutes |
| Max share TTL | 7 days |
| Default TTL | 24 hours |
| Per-IP daily upload | 10 GB total, 100 files |
| S3 pool total | 100 GB (across all active shares) |
| Token format | 4 alphanumeric chars (`[0-9A-Z]{4}`, extended to 5–6 on collision) |

## Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Upload page (drag-and-drop) |
| GET | `/docs` | API documentation for agent use |
| GET | `/admin` | Admin panel (shares + audit log, HTTP Basic auth) |
| GET | `/d/:token` | Download page (with password prompt if protected) |
| GET | `/api/download/:token` | 302 to presigned S3 URL (add `?info=1` for JSON metadata) |
| POST | `/api/download/:token` | Verify password → return download URL |
| POST | `/api/upload/init` | Reserve a presigned PUT URL (single or multipart) |
| POST | `/api/upload/complete` | Mint a share token |
| GET | `/api/health` | `{ status, db, s3, limits }` |
| GET/POST | `/api/admin/shares` | List shares (authenticated) |
| GET/POST | `/api/admin/audit` | List audit log (authenticated) |
| DELETE | `/api/admin/delete?token=X` | Delete a share (authenticated) |
| GET | `/api/admin/challenge` | Trigger browser Basic Auth dialog |
| GET/POST | `/api/cron/cleanup` | Manual cleanup trigger (requires `CRON_SECRET`) |

## Admin Panel

The admin panel at `/admin` is protected by HTTP Basic Authentication using
your S3 credentials. It provides two tabs:

- **Shares** — browse active/expired shares, search by filename or token, delete shares
- **Audit Log** — view all init/complete/download/delete events, filter by action type or IP

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

# Per-deploy
npm run deploy                             # builds + deploys
```

### DNS (already configured)

```
CNAME  share  →  cf-share.kurashizu123.workers.dev  (proxied)
```

## Architecture

```
Browser ──PUT──► S3 (presigned URL)
  │
  ├── POST /api/upload/init     ──► Worker ──► D1 (quota check)
  ├── POST /api/upload/complete ──► Worker ──► D1 (mint token)
  └── GET  /api/download/:token ──► Worker ──► D1 (lookup) ──► 302 to presigned S3 GET

Cleanup: cron every 30 min ──► Worker ──► D1 (find expired) ──► S3 (delete) ──► D1 (remove row)
```

## See Also

- `AGENTS.md` — agent orientation (compact handoff for AI coding agents)
- `/docs` — live API documentation page
