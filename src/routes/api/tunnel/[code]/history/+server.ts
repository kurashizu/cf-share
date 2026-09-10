import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { normalizeToken } from '@/lib/share/token';
import { listTunnelMessages, tunnelIsLive } from '@/lib/tunnel/store';

/**
 * GET /api/tunnel/:code/history
 *
 * Returns the last (up to 10) messages for a tunnel — used right after
 * joining, before the WebSocket has delivered anything new, so the room
 * doesn't render empty.
 */
export const GET: RequestHandler = async ({ platform, params }) => {
	const env = platform!.env;
	const code = normalizeToken(params.code);
	if (!code) {
		return json({ error: 'invalid tunnel code' }, { status: 400 });
	}

	if (!(await tunnelIsLive(env, code))) {
		return json({ error: 'tunnel expired or not found' }, { status: 404 });
	}

	const messages = await listTunnelMessages(env, code);
	return json({ messages });
};
