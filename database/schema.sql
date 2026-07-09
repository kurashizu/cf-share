-- cf-share canonical schema (mirror of database/migrations/0001_initial.sql).
-- Apply with:
--   wrangler d1 execute DB --local  --file=database/schema.sql
--   wrangler d1 execute DB --remote --file=database/schema.sql
--
-- Prefer the per-migration files for production deployments.

CREATE TABLE IF NOT EXISTS shares (
    token            TEXT PRIMARY KEY,
    bucket           TEXT NOT NULL,
    prefix           TEXT NOT NULL,
    s3_key           TEXT NOT NULL,
    filename         TEXT NOT NULL,
    size_bytes       INTEGER NOT NULL,
    content_type     TEXT NOT NULL,
    expires_at       INTEGER NOT NULL,
    created_at       INTEGER NOT NULL,
    created_ip       TEXT,
    user_agent       TEXT,
    download_count   INTEGER NOT NULL DEFAULT 0,
    last_download_at INTEGER,
    password_hash    TEXT,
    password_salt    TEXT
);
CREATE INDEX IF NOT EXISTS idx_shares_expires     ON shares(expires_at);
CREATE INDEX IF NOT EXISTS idx_shares_created_ip  ON shares(created_ip, created_at);
CREATE INDEX IF NOT EXISTS idx_shares_prefix      ON shares(prefix);

CREATE TABLE IF NOT EXISTS upload_quota (
    ip            TEXT NOT NULL,
    day           TEXT NOT NULL,
    total_bytes   INTEGER NOT NULL DEFAULT 0,
    count         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (ip, day)
);
CREATE INDEX IF NOT EXISTS idx_quota_day ON upload_quota(day);

CREATE TABLE IF NOT EXISTS audit_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ts            INTEGER NOT NULL,
    ip            TEXT,
    action        TEXT NOT NULL,
    share_token   TEXT,
    status        INTEGER,
    detail_json   TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts          ON audit_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_share_token ON audit_log(share_token, ts DESC);
