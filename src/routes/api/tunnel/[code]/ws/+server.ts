import type { RequestHandler } from '@sveltejs/kit';
import { normalizeToken } from '@/lib/share/token';
import { checkRateLimit } from '@/lib/rate-limit/check';
import { getClientIp } from '@/lib/util/ip';

/**
 * GET /api/tunnel/:code/ws
 *
 * Upgrades to a WebSocket and hands the connection off to the tunnel's
 * Durable Object (`TunnelRoom`, one instance per code, via idFromName).
 * The DO owns all room state — this route only validates the code shape
 * and forwards the Upgrade request.
 */
export const GET: RequestHandler = async ({ request, platform, params, getClientAddress }) => {
	const env = platform!.env;
	const code = normalizeToken(params.code);
	if (!code) {
		return new Response('invalid tunnel code', { status: 400 });
	}

	const ip = getClientIp(request, getClientAddress());
	const rl = await checkRateLimit(env, 'TUNNEL_JOIN_LIMIT', ip);
	if (!rl.success) {
		return new Response('Too Many Requests', { status: 429 });
	}

	if (request.headers.get('Upgrade') !== 'websocket') {
		return new Response('expected websocket upgrade', { status: 426 });
	}

	const id = env.TUNNEL.idFromName(code);
	const stub = env.TUNNEL.get(id);
	const url = new URL(request.url);
	url.searchParams.set('code', code);
	return stub.fetch(new Request(url, request));
};
