import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { deleteS3Object, deleteShareRow } from '@/lib/s3/cleanup';
import { audit } from '@/lib/util/audit';
import { getClientIp } from '@/lib/util/ip';
import { checkRateLimit } from '@/lib/rate-limit/check';
import { requestIsAuthorized } from '@/lib/admin/auth';
import { verifyDeleteGrant } from '@/lib/share/delete-grant';
import { findOwnedSig, buildOwnedCookieHeaderWithout } from '@/lib/share/owned-cookie';
import { normalizeToken } from '@/lib/share/token';

/**
 * DELETE /api/share/:token
 *
 * Self-service revocation: anyone holding the `cf_owned` cookie entry
 * minted for this token at upload time (see /api/upload/complete) may
 * delete it themselves — no login required. Admins may also delete any
 * share via their JWT cookie, same as /api/admin/delete.
 */
export const DELETE: RequestHandler = async ({ request, platform, params, getClientAddress }) => {
	const env = platform!.env;
	const ip = getClientIp(request, getClientAddress());

	const token = normalizeToken(params.token);
	if (!token) {
		return json({ error: 'Invalid token' }, { status: 400 });
	}

	const isAdmin = await requestIsAuthorized(env, request);

	if (!isAdmin) {
		const rl = await checkRateLimit(env, 'DOWNLOAD_LOOKUP_LIMIT', ip);
		if (!rl.success) {
			return json({ error: 'Too Many Requests' }, { status: 429 });
		}
	}

	const cookieHeader = request.headers.get('cookie');
	const ownedSig = findOwnedSig(cookieHeader, token);
	const authorized =
		isAdmin || (await verifyDeleteGrant(env, token, ownedSig));

	if (!authorized) {
		await audit(env, {
			ip,
			action: 'delete',
			shareToken: token,
			status: 403,
			detail: { reason: 'no-delete-grant' }
		});
		return json({ error: 'Not authorized to delete this share' }, { status: 403 });
	}

	const share = await env.DB.prepare(
		`SELECT bucket, s3_key, filename FROM shares WHERE token = ?1 LIMIT 1`
	)
		.bind(token)
		.first<{ bucket: string; s3_key: string; filename: string }>();

	if (!share) {
		return json({ error: 'Share not found' }, { status: 404 });
	}

	const s3Result = await deleteS3Object(env, share.bucket, share.s3_key);
	await deleteShareRow(env, token);

	await audit(env, {
		ip,
		action: 'delete',
		shareToken: token,
		status: 200,
		detail: {
			filename: share.filename,
			s3Deleted: s3Result.ok,
			via: isAdmin ? 'admin' : 'owner'
		}
	});

	const response = json({ success: true, s3Deleted: s3Result.ok });
	if (!isAdmin) {
		response.headers.append(
			'Set-Cookie',
			buildOwnedCookieHeaderWithout(cookieHeader, token, {
				secure: true,
				maxAgeSeconds: 400 * 24 * 60 * 60
			})
		);
	}
	return response;
};
