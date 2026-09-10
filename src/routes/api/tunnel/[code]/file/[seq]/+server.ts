import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { createS3Client, bucketName } from '@/lib/s3/client';
import { presignGet } from '@/lib/s3/presign';
import { verifyPassword } from '@/lib/share/password';
import { normalizeTunnelCode } from '@/lib/tunnel/code';
import { checkRateLimit } from '@/lib/rate-limit/check';
import { getClientIp } from '@/lib/util/ip';

const GET_TTL_SECONDS = 300;

async function resolveDownload(
	env: CloudflareEnv,
	code: string,
	seq: number,
	password: string | undefined
): Promise<Response> {
	const row = await env.DB.prepare(
		`SELECT password_hash, password_salt FROM tunnels WHERE code = ?1`
	)
		.bind(code)
		.first<{ password_hash: string | null; password_salt: string | null }>();

	if (!row) {
		return json({ error: 'Tunnel not found or expired' }, { status: 404 });
	}

	if (row.password_hash && row.password_salt) {
		if (!password) {
			return json({ error: 'Password required', needsPassword: true }, { status: 401 });
		}
		const ok = await verifyPassword(password, row.password_salt, row.password_hash);
		if (!ok) {
			return json({ error: 'Invalid password' }, { status: 401 });
		}
	}

	const id = env.TUNNEL.idFromName(code);
	const stub = env.TUNNEL.get(id);
	const file = await stub.getFileKey(seq);
	if (!file) {
		return json({ error: 'File not found — the tunnel history may have rolled it out' }, { status: 404 });
	}

	const client = createS3Client(env);
	const url = await presignGet({
		client,
		bucket: bucketName(env),
		key: file.r2Key,
		expiresIn: GET_TTL_SECONDS,
		filename: file.filename,
		contentType: file.contentType
	});

	return new Response(null, { status: 307, headers: { Location: url } });
}

/** GET works only for password-less tunnels — a password must go in a POST body, never a query string. */
export const GET: RequestHandler = async ({ params, platform, request, getClientAddress }) => {
	const env = platform!.env;
	const ip = getClientIp(request, getClientAddress());
	const rl = await checkRateLimit(env, 'TUNNEL_JOIN_LIMIT', ip);
	if (!rl.success) return json({ error: 'Too Many Requests' }, { status: 429 });

	const code = normalizeTunnelCode(params.code);
	const seq = Number(params.seq);
	if (!code || !Number.isInteger(seq)) {
		return json({ error: 'Invalid request' }, { status: 400 });
	}
	return resolveDownload(env, code, seq, undefined);
};

export const POST: RequestHandler = async ({ params, platform, request, getClientAddress }) => {
	const env = platform!.env;
	const ip = getClientIp(request, getClientAddress());
	const rl = await checkRateLimit(env, 'TUNNEL_JOIN_LIMIT', ip);
	if (!rl.success) return json({ error: 'Too Many Requests' }, { status: 429 });

	const code = normalizeTunnelCode(params.code);
	const seq = Number(params.seq);
	if (!code || !Number.isInteger(seq)) {
		return json({ error: 'Invalid request' }, { status: 400 });
	}

	let password: string | undefined;
	try {
		const body = (await request.json()) as { password?: unknown };
		password = typeof body.password === 'string' ? body.password : undefined;
	} catch {
		// no body — treated as password-less attempt
	}

	return resolveDownload(env, code, seq, password);
};
