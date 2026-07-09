# AGENTS.md

Agent orientation for `cf-share`.

## Project

Minimal file-sharing web app. Visitors upload a single file and receive a
short-lived download link. No login required.

Live at https://share.022025.xyz

## Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Upload page (drag-and-drop) |
| GET | `/docs` | API documentation |
| GET | `/admin` | Admin panel (HTTP Basic auth) |
| GET | `/d/:token` | Download page (HTML) |
| GET | `/api/download/:token` | 302 to presigned S3 URL |
| POST | `/api/download/:token` | Password verification |
| POST | `/api/upload/init` | Reserve presigned PUT URL |
| POST | `/api/upload/complete` | Mint share token |
| GET | `/api/health` | Health check |
| GET/POST | `/api/cron/cleanup` | Manual cleanup trigger |
| GET | `/api/admin/shares` | List shares (auth) |
| GET | `/api/admin/audit` | Audit log (auth) |
| DELETE | `/api/admin/delete` | Delete share (auth) |

## D1 Database

Schema in `database/schema.sql`.

| Table | Purpose |
|-------|---------|
| `shares` | Share tokens, S3 keys, TTL, password hash |
| `upload_quota` | Per-IP daily byte/count totals |
| `audit_log` | All init/complete/download/expire/delete events |

## S3 Storage

Single bucket (`cf-share`) on `s3api.022025.xyz`.
Key layout: `uploads/{YYYY}/{MM}/{DD}/{share-token}/{filename}`

All uploads go direct to S3 via presigned URL — Worker never sees file bytes.
Multipart upload used for files > 90 MB (50 MB parts).

## Limits

- Max file: 5 GB
- TTL: 5 min to 7 days (default 24h)
- Per-IP daily: 10 GB / 100 files
- S3 pool: 100 GB total
- Rate limits: 30 init / 30 complete / 60 download / 30 lookup per 60s

## Token Format

4 chars `[0-9A-Z]` (1,679,616 combos). Collisions extend to 5 then 6 chars.
See `lib/share/token.ts`.

## Key Files

- `components/uploader/Uploader.tsx` — Upload UI with XHR progress + speed tracking
- `lib/s3/` — S3 client, presign, multipart, cleanup, policy
- `lib/share/` — Token gen, password hash, D1 store
- `lib/admin/auth.ts` — HTTP Basic auth with S3 credentials
- `custom-worker.ts` — OpenNext wrapper + cron handler

## Common Commands

```bash
npm run dev              # next dev
npm run preview          # wrangler dev (workerd)
npm run deploy           # build + deploy
npm run cf-typegen       # regenerate cloudflare-env.d.ts
npm run s3:ping          # test S3 endpoint & creds
npm run db:migrate:remote
```

## Conventions

- All UI in English, TypeScript strict mode, Tailwind 4.
- Server-side validation on every API route; never trust the client.
- All S3 interactions go through `lib/s3/*` — no scattered `S3Client` instances.
