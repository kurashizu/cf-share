# AGENTS.md

Agent orientation for `cf-share`.

## Project

Minimal file-sharing web app. Visitors upload a single file and receive a
short-lived download link. No login. No accounts. No admin UI.

## Workers / Routes

- `cf-share` (this directory) — single Worker. Serves the upload page,
  `POST /api/upload/init`, `POST /api/upload/complete`, and `GET /d/:token`.
- No cron worker yet — daily cleanup runs as a `triggers.crons` handler
  inside this same Worker (`app/api/cron/cleanup/route.ts`, scheduled for M4).

## D1 Database

Created via `npx wrangler d1 create cf-share-db` (paste returned
`database_id` into `wrangler.jsonc`).

Schema lives in `database/schema.sql`. Apply locally with
`wrangler d1 execute DB --local --file=database/schema.sql` and remotely
with `wrangler d1 execute DB --remote --file=database/schema.sql`.

| Table          | Purpose                                                         |
|----------------|-----------------------------------------------------------------|
| `shares`       | One row per share token (token, s3 prefix, ttl, counts, ip)     |
| `share_files`  | One row per file in a share (s3 key, filename, size, etag)      |
| `upload_quota` | Per-IP daily byte/count totals (5 GB / 100 files hard caps)     |
| `audit_log`    | All init / complete / download / expire events                  |

## S3 Storage

Single bucket (`S3_BUCKET` env, default `cf-share`) on `s3api.022025.xyz`.

Key layout: `uploads/{YYYY}/{MM}/{DD}/{share-token}/{sanitized-filename}`

All objects are uploaded directly by the browser via presigned PUT URLs.
The Worker only:
1. Generates presigned URLs (`@aws-sdk/s3-request-presigner`).
2. Validates `HeadObject` after upload to confirm size/etag.
3. Generates presigned GET URLs for `GET /d/:token` (302 redirect).

The Worker **never** reads or writes file bodies.

## Secrets

S3 credentials live in `.dev.vars` for local dev and as Wrangler secrets
in production. Never commit them.

```
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
```

## Rate Limits

Five `[[ratelimits]]` bindings cover init / complete / download /
download-lookup / global IP daily. See `wrangler.jsonc` for exact values.

Daily byte/count quota (5 GB / 100 files per IP) is enforced via the
`upload_quota` D1 table — Cloudflare rate limits alone cannot enforce
byte budgets.

## Token Format

Short link = 4 characters from `[0-9A-Z]` (1,679,616 combinations).
Collisions cause length-extension up to 6 chars. See `lib/share/token.ts`.

## Common Commands

```bash
npm run dev              # next dev
npm run preview          # wrangler dev (workerd)
npm run deploy           # build + deploy
npm run cf-typegen       # regenerate cloudflare-env.d.ts
npm run s3:ping          # test S3 endpoint & creds
```

## Conventions

- All UI strings in English.
- TypeScript strict mode.
- Tailwind 4 utility classes; no custom CSS unless necessary.
- Server-side validation on every API route; never trust the client.
- All S3 interactions go through `lib/s3/*` — no scattered `S3Client`
  instantiations.
- D1 migrations go through `database/schema.sql` + `wrangler d1 execute`.