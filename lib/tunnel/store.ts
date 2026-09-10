/// <reference path="../../cloudflare-env.d.ts" />

import { generateUniqueToken } from "../share/token";

/** How long an unjoined tunnel stays reservable before it's considered stale. */
export const TUNNEL_JOIN_TIMEOUT_MS = 30 * 60 * 1000;

/** Max messages kept per tunnel; the (N+1)th insert evicts the oldest. */
export const MAX_TUNNEL_MESSAGES = 10;

export interface TunnelMessage {
  seq: number;
  kind: "text" | "file" | "share";
  body: string | null;
  shareToken: string | null;
  filename: string | null;
  sizeBytes: number;
  sender: "a" | "b";
  createdAt: number;
}

async function tunnelCodeExists(env: CloudflareEnv, code: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS x FROM active_tunnels WHERE code = ?1 LIMIT 1`,
  )
    .bind(code)
    .first<{ x: number }>();
  return !!row;
}

/** Mint a unique tunnel code and register it as freshly-created (unjoined). */
export async function createTunnel(env: CloudflareEnv): Promise<{ code: string }> {
  const code = await generateUniqueToken((c) => tunnelCodeExists(env, c));
  await env.DB.prepare(
    `INSERT INTO active_tunnels (code, created_at, joined_at) VALUES (?1, ?2, NULL)`,
  )
    .bind(code, Date.now())
    .run();
  return { code };
}

/** Mark a tunnel as joined (second peer connected) — cancels the join-timeout alarm's purpose. */
export async function markTunnelJoined(env: CloudflareEnv, code: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE active_tunnels SET joined_at = ?2 WHERE code = ?1 AND joined_at IS NULL`,
  )
    .bind(code, Date.now())
    .run();
}

/** True if the tunnel code is registered and still within its join window (or already joined). */
export async function tunnelIsLive(env: CloudflareEnv, code: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT created_at, joined_at FROM active_tunnels WHERE code = ?1 LIMIT 1`,
  )
    .bind(code)
    .first<{ created_at: number; joined_at: number | null }>();
  if (!row) return false;
  if (row.joined_at !== null) return true;
  return Date.now() - row.created_at < TUNNEL_JOIN_TIMEOUT_MS;
}

/** Fully tear down a tunnel: drop its registration and message history. */
export async function destroyTunnel(env: CloudflareEnv, code: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM active_tunnels WHERE code = ?1`).bind(code),
    env.DB.prepare(`DELETE FROM tunnel_messages WHERE code = ?1`).bind(code),
  ]);
}

/** Append a message and evict anything past the last MAX_TUNNEL_MESSAGES for this code. */
export async function appendTunnelMessage(
  env: CloudflareEnv,
  code: string,
  msg: Omit<TunnelMessage, "seq" | "createdAt">,
): Promise<TunnelMessage> {
  const createdAt = Date.now();
  const nextSeqRow = await env.DB.prepare(
    `SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM tunnel_messages WHERE code = ?1`,
  )
    .bind(code)
    .first<{ next: number }>();
  const seq = nextSeqRow?.next ?? 1;

  await env.DB.prepare(
    `INSERT INTO tunnel_messages
			 (code, seq, kind, body, share_token, filename, size_bytes, sender, created_at)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  )
    .bind(
      code,
      seq,
      msg.kind,
      msg.body,
      msg.shareToken,
      msg.filename,
      msg.sizeBytes,
      msg.sender,
      createdAt,
    )
    .run();

  await env.DB.prepare(
    `DELETE FROM tunnel_messages
			 WHERE code = ?1 AND seq < (
				 SELECT seq FROM tunnel_messages WHERE code = ?1
				 ORDER BY seq DESC LIMIT 1 OFFSET ?2
			 )`,
  )
    .bind(code, MAX_TUNNEL_MESSAGES - 1)
    .run();

  return { ...msg, seq, createdAt };
}

/** Most recent messages for a code, oldest first (chronological render order). */
export async function listTunnelMessages(
  env: CloudflareEnv,
  code: string,
): Promise<TunnelMessage[]> {
  const { results } = await env.DB.prepare(
    `SELECT seq, kind, body, share_token, filename, size_bytes, sender, created_at
			 FROM tunnel_messages WHERE code = ?1 ORDER BY seq ASC LIMIT ?2`,
  )
    .bind(code, MAX_TUNNEL_MESSAGES)
    .all<{
      seq: number;
      kind: "text" | "file" | "share";
      body: string | null;
      share_token: string | null;
      filename: string | null;
      size_bytes: number;
      sender: "a" | "b";
      created_at: number;
    }>();

  return results.map((r) => ({
    seq: r.seq,
    kind: r.kind,
    body: r.body,
    shareToken: r.share_token,
    filename: r.filename,
    sizeBytes: r.size_bytes,
    sender: r.sender,
    createdAt: r.created_at,
  }));
}
