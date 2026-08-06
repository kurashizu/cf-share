import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import {
	ADMIN_COOKIE_NAME,
	passwordsMatch,
	signAdminJwt
} from '@/lib/admin/auth';
import { serializeCookie } from '@/lib/admin/cookie';
import { audit } from '@/lib/util/audit';
import { getClientIp } from '@/lib/util/ip';

/**
 * POST /api/admin/login
 *
 * Body: `{ password: string }`
 *
 * On success: returns 200 with the JWT (also set as an HttpOnly cookie) and
 * the cookie's expiry timestamp. On failure: returns 401.
 */
export const POST: RequestHandler = async ({ request, platform, getClientAddress }) => {
	const env = platform!.env;
	const ip = getClientIp(request, getClientAddress());

	let body: { password?: unknown };
	try {
		body = (await request.json()) as { password?: unknown };
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const submitted = typeof body.password === 'string' ? body.password : '';
	if (!submitted) {
		return json({ error: 'Password is required' }, { status: 400 });
	}

	if (!passwordsMatch(submitted, env.ADMIN_PASSWORD)) {
		// Log failed attempts so brute force is detectable from the audit log.
		await audit(env, {
			ip,
			action: 'admin_view',
			status: 401,
			detail: { reason: 'login-failed' }
		});
		return json({ error: 'Invalid password' }, { status: 401 });
	}

	const { token, expiresAt } = await signAdminJwt(env);
	const ttl = Math.max(1, expiresAt - Math.floor(Date.now() / 1000));

	await audit(env, {
		ip,
		action: 'admin_view',
		status: 200,
		detail: { reason: 'login-success' }
	});

	const cookie = serializeCookie(ADMIN_COOKIE_NAME, token, {
		maxAge: ttl,
		httpOnly: true,
		secure: true,
		sameSite: 'Lax',
		path: '/'
	});

	return json(
		{ success: true, expiresAt },
		{ headers: { 'Set-Cookie': cookie } }
	);
};