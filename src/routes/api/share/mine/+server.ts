import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { parseOwnedCookie, OWNED_COOKIE_NAME } from '@/lib/share/owned-cookie';
import { serializeCookie } from '@/lib/admin/cookie';

interface MineEntry {
	token: string;
	filename: string;
	sizeBytes: number;
	expiresAt: number;
	createdAt: number;
	downloadCount: number;
	hasPassword: boolean;
}

/**
 * GET /api/share/mine
 *
 * Lists the shares this browser has minted, per the `cf_owned` cookie set
 * by /api/upload/complete. Drops any token whose D1 row is gone (expired
 * and reaped by the cleanup cron, or already self-deleted) and rewrites
 * the cookie without it, so the list — and the cookie's size — stay in
 * sync with reality over time.
 */
export const GET: RequestHandler = async ({ request, platform }) => {
	const env = platform!.env;
	const cookieHeader = request.headers.get('cookie');
	const owned = parseOwnedCookie(cookieHeader);

	if (owned.length === 0) {
		return json({ shares: [] });
	}

	const tokens = owned.map((e) => e.t);
	const placeholders = tokens.map((_, i) => `?${i + 1}`).join(',');
	const rows = await env.DB.prepare(
		`SELECT token, filename, size_bytes, expires_at, created_at, download_count, password_hash
		 FROM shares
		 WHERE token IN (${placeholders}) AND (expires_at = 0 OR expires_at > ?${tokens.length + 1})`
	)
		.bind(...tokens, Date.now())
		.all<{
			token: string;
			filename: string;
			size_bytes: number;
			expires_at: number;
			created_at: number;
			download_count: number;
			password_hash: string | null;
		}>();

	const found = new Map((rows.results ?? []).map((r) => [r.token, r]));
	const shares: MineEntry[] = [];
	for (const t of tokens) {
		const r = found.get(t);
		if (!r) continue; // expired/deleted — drop silently, rewritten below
		shares.push({
			token: r.token,
			filename: r.filename,
			sizeBytes: r.size_bytes,
			expiresAt: r.expires_at,
			createdAt: r.created_at,
			downloadCount: r.download_count,
			hasPassword: !!r.password_hash
		});
	}
	// Newest upload first.
	shares.sort((a, b) => b.createdAt - a.createdAt);

	const response = json({ shares });

	// Prune stale tokens from the cookie so it doesn't grow unbounded with
	// dead entries. Rebuild from scratch (not buildOwnedCookieHeader, which
	// only appends) since we may be dropping several entries at once.
	const survivors = owned.filter((e) => found.has(e.t));
	if (survivors.length !== owned.length) {
		response.headers.append(
			'Set-Cookie',
			serializeCookie(OWNED_COOKIE_NAME, JSON.stringify(survivors), {
				maxAge: 400 * 24 * 60 * 60,
				httpOnly: true,
				secure: true,
				sameSite: 'Lax'
			})
		);
	}

	return response;
};

/**
 * DELETE /api/share/mine
 *
 * Clears the `cf_owned` cookie entirely — used by the Settings panel's
 * "clear site preferences" action. Does not touch the underlying shares;
 * it only forfeits this browser's ability to self-revoke them early (they
 * still expire normally via TTL).
 */
export const DELETE: RequestHandler = async () => {
	const response = json({ success: true });
	response.headers.append(
		'Set-Cookie',
		serializeCookie(OWNED_COOKIE_NAME, '', {
			maxAge: 0,
			httpOnly: true,
			secure: true,
			sameSite: 'Lax'
		})
	);
	return response;
};
