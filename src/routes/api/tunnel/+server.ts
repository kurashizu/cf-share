import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { checkRateLimit } from '@/lib/rate-limit/check';
import { getClientIp } from '@/lib/util/ip';
import { createTunnel, TUNNEL_JOIN_TIMEOUT_MS } from '@/lib/tunnel/store';

/**
 * POST /api/tunnel
 *
 * Mints a new clipboard-tunnel code. The tunnel stays reservable for
 * TUNNEL_JOIN_TIMEOUT_MS while unjoined; once a second peer connects over
 * the WebSocket it lives until both peers disconnect.
 */
export const POST: RequestHandler = async ({ request, platform, getClientAddress }) => {
	const env = platform!.env;
	const ip = getClientIp(request, getClientAddress());

	const rl = await checkRateLimit(env, 'TUNNEL_CREATE_LIMIT', ip);
	if (!rl.success) {
		return json({ error: 'Too Many Requests' }, { status: 429 });
	}

	const { code } = await createTunnel(env);
	return json({ code, joinTimeoutMs: TUNNEL_JOIN_TIMEOUT_MS });
};
