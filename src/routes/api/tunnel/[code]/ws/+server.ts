import type { RequestHandler } from '@sveltejs/kit';
import { normalizeTunnelCode } from '@/lib/tunnel/code';
import { checkRateLimit } from '@/lib/rate-limit/check';
import { getClientIp } from '@/lib/util/ip';
import { audit } from '@/lib/util/audit';

/**
 * GET /api/tunnel/:code/ws
 *
 * Upgrades to a WebSocket and forwards straight into the tunnel's Durable
 * Object. Query params `name` (display name) and `password` (if the tunnel
 * has one) are read by TunnelRoomV2.fetch() itself — this route only does
 * the D1-backed existence/rate-limit checks a DO can't do on its own
 * (DO ids are never "not found", so without this D1 lookup any random
 * 'Z'-prefixed string would silently spin up an empty room).
 */
export const GET: RequestHandler = async ({ request, params, platform, getClientAddress }) => {
	const env = platform!.env;
	const ip = getClientIp(request, getClientAddress());

	const code = normalizeTunnelCode(params.code);
	if (!code) {
		return new Response('Invalid tunnel code', { status: 400 });
	}

	const rl = await checkRateLimit(env, 'TUNNEL_JOIN_LIMIT', ip);
	if (!rl.success) {
		return new Response('Too Many Requests', { status: 429 });
	}

	const row = await env.DB.prepare(
		`SELECT expires_at FROM tunnels WHERE code = ?1`
	)
		.bind(code)
		.first<{ expires_at: number }>();

	if (!row) {
		return new Response('Tunnel not found or expired', { status: 404 });
	}
	if (row.expires_at !== 0 && row.expires_at < Date.now()) {
		return new Response('Tunnel not found or expired', { status: 404 });
	}

	const id = env.TUNNEL.idFromName(code);
	const stub = env.TUNNEL.get(id);
	const response = await stub.fetch(request);

	if (response.status === 101 && row.expires_at !== 0) {
		// First successful join: this tunnel is no longer subject to the
		// unjoined-tunnel TTL. Its lifetime is now owned by the DO (wiped
		// when all peers disconnect).
		await env.DB.prepare(`UPDATE tunnels SET expires_at = 0 WHERE code = ?1`)
			.bind(code)
			.run();
	}

	await audit(env, {
		ip,
		action: 'tunnel_join',
		shareToken: code,
		status: response.status
	});

	return response;
};
