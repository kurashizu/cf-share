# AGENTS.md

Agent orientation for `cf-share`.

## Project

Minimal file-sharing web app. Visitors upload a single file and receive a
short-lived download link. No login required.

Live at https://share.krsz.in (see `lib/config/app.ts` for the authoritative value)

## Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Upload page (drag-and-drop) |
| GET | `/docs` | API documentation |
| GET | `/admin` | Admin panel (JWT cookie set at `/admin/login`) |
| GET | `/admin/login` | Admin login form |
| GET | `/d/:token` | Download page (HTML) |
| GET | `/api/download/:token` | Stream file bytes from S3 through the Worker (TransformStream pipe, supports Range) |
| POST | `/api/download/:token` | Password verification |
| POST | `/api/upload/init` | Reserve presigned PUT URL (admin auth skips all quotas) |
| POST | `/api/upload/resume` | Re-sign missing parts for interrupted multipart upload |
| POST | `/api/upload/complete` | Mint share token |
| GET | `/api/health` | Health check |
| GET/POST | `/api/cron/cleanup` | Manual cleanup trigger |
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

Downloads are proxied through the Worker: it looks up the share in D1,
presigns an S3 GET, fetches S3, and pipes the body back via a
`TransformStream` (must NOT be returned as `new Response(upstream.body)`
directly — that truncates under OpenNext's nodejs runtime).

## Limits

- Max file: 5 GB (anon), 100 GB (admin via Basic auth)
- TTL: 5 min to 7 days (default 24h)
- Per-IP daily: 20 GB / 100 files (admin bypasses)
- S3 pool: 100 GB total (admin bypasses)
- Rate limits: 30 init / 30 complete / 60 download / 30 lookup per 60s (admin bypasses)
- Presigned PUT URL TTL: 1 hour (multipart uploads for large files)
- Resume: client tracks parts in localStorage, calls `/api/upload/resume` to re-sign missing parts

## Token Format

4 chars `[0-9A-Z]` (1,679,616 combos). Collisions extend to 5 then 6 chars.
See `lib/share/token.ts`.

## Key Files

- `components/uploader/Uploader.tsx` — Upload UI with XHR progress + speed tracking
- `lib/s3/` — S3 client, presign, multipart, cleanup, policy
- `lib/share/` — Token gen, password hash, D1 store
- `lib/admin/auth.ts` — JWT sign/verify for admin sessions (`cf_admin` cookie)
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
- Download proxy: keep `runtime = "nodejs"` and pipe the upstream body through
  a `TransformStream` (`upstream.body.pipeTo(writable)` → return `readable`).
  Do NOT return `upstream.body` directly, and do NOT switch the route to
  `runtime = "edge"` (OpenNext 1.19.9 cannot load edge app routes → 500).
  See `app/api/download/[token]/route.ts` and README "Gotchas".
