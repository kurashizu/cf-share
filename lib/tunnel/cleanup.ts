/// <reference path="../../cloudflare-env.d.ts" />

/**
 * Prune tunnel codes that were minted but never joined by a second peer
 * within their TTL (see TUNNEL_TTL_MS in the create route). Once a second
 * peer actually joins, the join route sets expires_at = 0 on that row —
 * this query only ever touches rows still waiting for their first join.
 * The Durable Object itself needs no cleanup here — if nobody ever
 * connected, it has no history to wipe. Deleting the D1 row is what makes
 * the code stop being accepted by the join route.
 */
export async function pruneExpiredTunnels(env: CloudflareEnv): Promise<number> {
	const r = await env.DB.prepare(
		`DELETE FROM tunnels WHERE expires_at != 0 AND expires_at < ?1`
	)
		.bind(Date.now())
		.run();
	return (r.meta as { changes?: number } | undefined)?.changes ?? 0;
}
