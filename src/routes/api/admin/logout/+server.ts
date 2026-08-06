import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { ADMIN_COOKIE_NAME } from '@/lib/admin/auth';
import { serializeCookie } from '@/lib/admin/cookie';

/**
 * POST /api/admin/logout
 *
 * Clears the `cf_admin` cookie. Always succeeds.
 */
export const POST: RequestHandler = async () => {
	const cookie = serializeCookie(ADMIN_COOKIE_NAME, '', {
		maxAge: 0,
		httpOnly: true,
		secure: true,
		sameSite: 'Lax',
		path: '/'
	});
	return json({ success: true }, { headers: { 'Set-Cookie': cookie } });
};