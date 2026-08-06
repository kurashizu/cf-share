import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { requestIsAuthorized } from '@/lib/admin/auth';

/**
 * GET /api/admin/me
 *
 * Returns 200 with `{ authenticated: true }` if the caller has a valid
 * admin JWT cookie, otherwise 401.
 */
export const GET: RequestHandler = async ({ request, platform }) => {
	const env = platform!.env;
	if (await requestIsAuthorized(env, request)) {
		return json({ authenticated: true });
	}
	return json({ error: 'Unauthorized' }, { status: 401 });
};