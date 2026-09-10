import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { generateUniqueTunnelCode } from '@/lib/tunnel/code';
import { hashPassword, isValidPassword } from '@/lib/share/password';
import { checkRateLimit } from '@/lib/rate-limit/check';
import { getClientIp } from '@/lib/util/ip';
import { audit } from '@/lib/util/audit';

const TUNNEL_TTL_MS = 24 * 60 * 60 * 1000; // unjoined tunnels self-expire after 1 day

interface CreateBody {
	password?: unknown;
}

/**
 * POST /api/tunnel
 *
 * Mints a 'Z'-prefixed tunnel code and, if a password was given, stores its
 * hash both in D1 (existence/uniqueness record) and on the Durable Object
 * itself (the thing that actually gates the WebSocket join).
 */
export const POST: RequestHandler = async ({ request, platform, getClientAddress }) => {
	const env = platform!.env;
	const ip = getClientIp(request, getClientAddress());

	const rl = await checkRateLimit(env, 'TUNNEL_CREATE_LIMIT', ip);
	if (!rl.success) {
		return json({ error: 'Too Many Requests' }, { status: 429 });
	}

	let body: CreateBody = {};
	try {
		body = (await request.json()) as CreateBody;
	} catch {
		// No body is fine — password is optional.
	}

	let passwordHash: string | null = null;
	let passwordSalt: string | null = null;
	if (body.password !== undefined && body.password !== null && body.password !== '') {
		if (!isValidPassword(body.password)) {
			return json({ error: 'Invalid password' }, { status: 400 });
		}
		const hashed = await hashPassword(body.password as string);
		passwordHash = hashed.hash;
		passwordSalt = hashed.salt;
	}

	const code = await generateUniqueTunnelCode(async (candidate) => {
		const row = await env.DB.prepare(`SELECT 1 FROM tunnels WHERE code = ?1`)
			.bind(candidate)
			.first();
		return row !== null;
	});

	const now = Date.now();
	await env.DB.prepare(
		`INSERT INTO tunnels (code, password_hash, password_salt, created_at, created_ip, expires_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
	)
		.bind(code, passwordHash, passwordSalt, now, ip, now + TUNNEL_TTL_MS)
		.run();

	const id = env.TUNNEL.idFromName(code);
	const stub = env.TUNNEL.get(id);
	await stub.setPassword(passwordHash, passwordSalt);

	await audit(env, { ip, action: 'tunnel_create', shareToken: code, status: 200 });

	return json({ code, hasPassword: passwordHash !== null, expiresAt: now + TUNNEL_TTL_MS });
};
