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
| POST | `/api/upload/complete` | Mint share token; sets `cf_owned` delete-grant cookie for it |
| DELETE | `/api/share/:token` | Self-service delete via `cf_owned` cookie (or admin JWT) |
| GET | `/api/share/mine` | List shares owned by this browser; prunes dead tokens from `cf_owned` |
| DELETE | `/api/share/mine` | Clear the `cf_owned` cookie (Settings panel) |
| GET | `/api/health` | Health check |
| GET/POST | `/api/cron/cleanup` | Manual cleanup trigger (`X-Cron-Secret`) |
| GET/POST | `/api/admin/shares` | List shares (auth) |
| GET/POST | `/api/admin/audit` | Audit log (auth) |
| DELETE | `/api/admin/delete` | Delete share (auth) |
| POST | `/api/admin/login` | Submit password, set `cf_admin` JWT cookie |
| POST | `/api/admin/logout` | Clear `cf_admin` cookie |
| GET | `/api/admin/me` | Auth check (returns 401 if no/invalid cookie) |
| GET | `/tunnel/:code` | Tunnel room (join form, then the live chat view). Creation is a `tunnel` tab inside the home page's Uploader, not a separate route — mirrors the existing `file`/`text` tabs |
| POST | `/api/tunnel` | Mint a `Z`-prefixed tunnel code; optional password |
| GET | `/api/tunnel/:code/ws` | WebSocket upgrade, forwarded into `TunnelRoomV2` |
| GET/POST | `/api/tunnel/:code/file/:seq` | Redirect to a presigned S3 URL for an inline file message; POST for password-protected tunnels |

## D1 Database

Schema in `database/schema.sql`.

| Table | Purpose |
|-------|---------|
| `shares` | Share tokens, S3 keys, TTL, password hash |
| `upload_quota` | Per-IP daily byte/count totals |
| `audit_log` | All init/complete/download/expire/delete/tunnel_create/tunnel_join events |
| `tunnels` | Tunnel code existence/uniqueness + optional password hash — never message content (that lives in the DO, see below) |

## S3 Storage

Single bucket (`cf-share`) on `s3api.022025.xyz` (see `lib/config/app.ts` → `S3_PUBLIC_ENDPOINT`).
Key layout: `uploads/{YYYY}/{MM}/{DD}/{share-token}/{filename}`

All uploads go direct to S3 via presigned URL — Worker never sees upload
bytes. Multipart upload used for files > 90 MB (50 MB parts).

Normal downloads are authenticated redirects in `src/routes/api/download/[token]/+server.ts`:
look up the share in D1, perform the password gate and audit, then return a
short-lived 307 redirect to the presigned S3 URL. Small, unprotected files
also have a `/p/:token` Worker-proxied link limited by `PROXY_MAX_FILE_SIZE`;
that route streams the complete S3 body without buffering and does not support Range.

## Limits

- Max file: 5 GB (anon), 100 GB (admin via JWT cookie)
- TTL: 5 min to 7 days (default 24h)
- Per-IP daily: 20 GB / 100 files (admin bypasses)
- S3 pool: 100 GB / 50,000 active shares total (admin bypasses)
- Proxied link threshold: 2 MiB by default (`PROXY_MAX_FILE_SIZE`), unprotected files only
- Rate limits: 30 init / 30 complete / 60 download / 30 lookup per 60s (admin bypasses)
- Presigned PUT URL TTL: 1 hour (multipart uploads for large files)
- Presigned GET URL TTL: remaining share TTL, capped at 7 days by SigV4
- Resume: client tracks parts in localStorage, calls `/api/upload/resume` to re-sign missing parts

## Token Format

Fixed 4 chars Crockford Base32 `[0-9ABCDEFGHJKMNPQRSTVWXYZ]` (1,048,576 combos,
excludes I, L, O, U); error-tolerant decoding maps `O`->`0`, `I`/`L`->`1`, `U`->`V`, case-insensitive.
Collisions redraw at the same length. The active-share pool is capped at `MAX_TOTAL_COUNT` (50k)
so random generation never starves. Legacy 5-6 char tokens still validate.
See `lib/share/token.ts`.

**Tunnel codes** are `Z` + 3 Crockford Base32 chars — `Z` is reserved (share
token generation redraws if it lands on a leading `Z`), so a lookup can
route on the first character alone without querying two tables. See
`lib/tunnel/code.ts`.

## Clipboard Tunnels

Up to 4 peers join a tunnel by code and exchange text/files/images in real
time over a Durable-Object-relayed WebSocket.

- **Transport**: `TunnelRoomV2` (`lib/tunnel/room.ts`), one DO instance per
  code, hibernatable WebSockets (no polling cost — the instance can unload
  between messages). Broadcasts go to *all* connected peers including the
  sender; the client tells its own messages apart by a per-connection `id`
  from the `welcome` message, not by display name (two peers can share a name).
- **History**: last 10 messages live in the DO's own `state.storage` as an
  LRU — **not D1**. Wiped, along with any R2 objects a file message
  referenced, once every peer disconnects (`wipeRoom()`). The cleanup cron
  never looks at tunnel-produced R2 keys, so this is the only thing that
  ever deletes them.
- **Size tiers**: ≤1 MiB inline (text → DO storage; image/file → R2 with
  the DO storing just a pointer, to dodge base64-inflation risk against the
  SQLite-backed 2 MiB key+value cap). Over 1 MiB falls back to the normal
  share pipeline and posts a share-link card instead — same UI, different
  backing store, the user shouldn't be able to tell.
- **Password**: reuses `lib/share/password.ts` (PBKDF2). Checked during the
  WebSocket upgrade in `TunnelRoomV2.fetch()`, and again by
  `/api/tunnel/:code/file/:seq` before handing out a presigned URL.
- **D1's `tunnels` table** only tracks code existence — unjoined tunnels get
  `expires_at` set to a day out and are pruned by the cleanup cron
  (`lib/tunnel/cleanup.ts`); the join route flips `expires_at` to `0` the
  moment a second peer connects, handing the tunnel's lifetime over to the DO.
- **Cannot be tested with `npm run dev`** — Durable Objects don't run under
  `vite dev`'s platform proxy (a Cloudflare limitation, not this app's).
  Verify tunnel changes against the deployed Worker.
- **`src/hooks.server.ts` skips `response.status === 101`** before setting
  security headers — a WebSocket upgrade `Response`'s headers are immutable
  in the Workers runtime, and mutating them 500s every join.

## Key Files

- `src/lib/Uploader.svelte` (+ `FileItem.svelte`, `ResultPanel.svelte`, `client/resume.ts`) — upload UI
- `src/lib/MyShares.svelte` — "my shares" sidebar card; lists + self-deletes shares owned by this browser
- `src/lib/CookieConsent.svelte`, `src/lib/SettingsPanel.svelte`, `src/lib/client/prefs.ts` — first-visit consent modal and the Settings panel's "clear site preferences & cache" action
- `src/lib/DownloadPage.svelte` — `/d/:token` page component
- `src/routes/admin/+page.svelte` — admin panel (shares/audit/upload tabs)
- `lib/s3/` — S3 client, presign, multipart, cleanup, policy, polyfill
- `lib/share/` — Token gen, password hash (Web Crypto), D1 store, upload/delete grants, `cf_owned` cookie
- `lib/admin/auth.ts` — JWT sign/verify for admin sessions (`cf_admin` cookie)
- `lib/tunnel/` — `room.ts` (the `TunnelRoomV2` Durable Object), `code.ts` (Z-prefixed code gen), `cleanup.ts` (unjoined-tunnel D1 pruning)
- `src/lib/Uploader.svelte` — also hosts the `tunnel` tab (create + password), exposes `switchToTunnel()` for the home page's quick_facts link
- `src/routes/tunnel/[code]/+page.svelte` — join form + the live room UI
- `src/lib/client/tunnel-socket.ts` — client WebSocket wrapper (heartbeat, message types)
- `src/lib/client/avatar.ts` — hash-derived per-name avatar color, no network/storage
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
  unprotected files at or below `PROXY_MAX_FILE_SIZE`, streams the complete
  object without Range support, buffering, caching, or background reads.
- Env: use `event.platform.env`; the application runs on adapter-cloudflare.
