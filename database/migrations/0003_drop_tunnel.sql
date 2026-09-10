-- cf-share: drop the abandoned first-draft tunnel tables (never held real data)
-- Superseded revision of the peer-to-peer clipboard tunnel feature is coming later.

DROP TABLE IF EXISTS tunnel_messages;
DROP TABLE IF EXISTS active_tunnels;
