-- cf-share initial schema
-- Applied via:
--   wrangler d1 execute DB --local --file=database/migrations/0001_initial.sql
--   wrangler d1 execute DB --remote --file=database/migrations/0001_initial.sql

-- ─────────────────────────────────────────────────────────────────────────────
-- shares: one row per share token (a "share" = one uploaded file)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shares (
    token            TEXT PRIMARY KEY,             -- 4-6 chars from [0-9A-Z]
    bucket           TEXT NOT NULL,
    prefix           TEXT NOT NULL,                -- e.g. 'uploads/2026/07/09/A3K7'
    s3_key           TEXT NOT NULL,                -- full key of the single file
    filename         TEXT NOT NULL,                -- original filename (display)
    size_bytes       INTEGER NOT NULL,
    content_type     TEXT NOT NULL,
    expires_at       INTEGER NOT NULL,             -- unix ms
    created_at       INTEGER NOT NULL,
    created_ip       TEXT,                         -- 30-day retention
    user_agent       TEXT,
    download_count   INTEGER NOT NULL DEFAULT 0,
    last_download_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_shares_expires     ON shares(expires_at);
CREATE INDEX IF NOT EXISTS idx_shares_created_ip  ON shares(created_ip, created_at);
CREATE INDEX IF NOT EXISTS idx_shares_prefix      ON shares(prefix);

-- ─────────────────────────────────────────────────────────────────────────────
-- upload_quota: per-IP daily byte/count totals (5 GB / 100 files hard caps)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS upload_quota (
    ip            TEXT NOT NULL,
    day           TEXT NOT NULL,                   -- 'YYYY-MM-DD' UTC
    total_bytes   INTEGER NOT NULL DEFAULT 0,
    count         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (ip, day)
);
CREATE INDEX IF NOT EXISTS idx_quota_day ON upload_quota(day);

-- ─────────────────────────────────────────────────────────────────────────────
-- audit_log: every init / complete / download / expire event
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ts            INTEGER NOT NULL,
    ip            TEXT,
    action        TEXT NOT NULL,                   -- 'init' | 'complete' | 'download' | 'expire'
    share_token   TEXT,
    status        INTEGER,
    detail_json   TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts          ON audit_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_share_token ON audit_log(share_token, ts DESC);
