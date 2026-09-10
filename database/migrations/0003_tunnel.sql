-- cf-share: peer-to-peer clipboard tunnels
-- Run after 0002_password.sql

-- ─────────────────────────────────────────────────────────────────────────────
-- active_tunnels: one row per open tunnel code (created -> joined/expired)
-- Doubles as the code-collision check when minting a new code.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS active_tunnels (
    code       TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    joined_at  INTEGER            -- NULL until the second peer connects
);
CREATE INDEX IF NOT EXISTS idx_active_tunnels_created ON active_tunnels(created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- tunnel_messages: last 10 messages per tunnel code (LRU-evicted on insert)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tunnel_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT NOT NULL,
    seq         INTEGER NOT NULL,
    kind        TEXT NOT NULL,       -- 'text' | 'share'
    body        TEXT,                -- inline text/base64 payload (kind='text')
    share_token TEXT,                -- set when kind='share'
    filename    TEXT,
    size_bytes  INTEGER NOT NULL,
    sender      TEXT NOT NULL,       -- 'a' | 'b'
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tunnel_messages_code_seq ON tunnel_messages(code, seq DESC);
