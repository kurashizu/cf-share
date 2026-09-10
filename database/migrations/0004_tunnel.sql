-- cf-share: clipboard-tunnel rooms
-- Run after 0003_drop_tunnel.sql
--
-- Message history and connection state live in the TunnelRoomV2 Durable
-- Object's own storage (LRU, wiped when all peers disconnect) — this table
-- only tracks whether a code has been minted, for uniqueness checks and to
-- distinguish "no such tunnel" from "tunnel exists but is empty/expired".

CREATE TABLE IF NOT EXISTS tunnels (
    code          TEXT PRIMARY KEY,   -- 'Z' + 3-char Crockford Base32
    password_hash TEXT,
    password_salt TEXT,
    created_at    INTEGER NOT NULL,
    created_ip    TEXT,
    expires_at    INTEGER NOT NULL    -- unix ms; unjoined tunnels self-expire
);
CREATE INDEX IF NOT EXISTS idx_tunnels_expires ON tunnels(expires_at);
