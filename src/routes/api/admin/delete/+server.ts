import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { deleteS3Object, deleteShareRow } from '@/lib/s3/cleanup';
import { audit } from '@/lib/util/audit';
import { getClientIp } from '@/lib/util/ip';
import { requestIsAuthorized } from '@/lib/admin/auth';
import { normalizeToken } from '@/lib/share/token';

/**
 * DELETE /api/admin/delete?token=XXXX
 *
 * Deletes a single share: removes the S3 object and the D1 row.
 * Protected by JWT cookie set at /api/admin/login.
 * Logs the action to audit_log.
 */
export const DELETE: RequestHandler = async ({
	request,
	platform,
	url,
	getClientAddress
}) => {
	const env = platform!.env;

	// ── Auth ─────────────────────────────────────────────────────────────────────
	if (!(await requestIsAuthorized(env, request))) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	// ── Validate ──────────────────────────────────────────────────────────
	const rawToken = url.searchParams.get('token');
	const token = normalizeToken(rawToken);
	if (!token) {
		return json({ error: 'Invalid token' }, { status: 400 });
	}

	const ip = getClientIp(request, getClientAddress());

	// ── Fetch share ───────────────────────────────────────────────────────
	const share = await env.DB.prepare(
		`SELECT bucket, s3_key, filename FROM shares WHERE token = ?1 LIMIT 1`
	)
		.bind(token)
		.first<{ bucket: string; s3_key: string; filename: string }>();

	if (!share) {
		return json({ error: 'Share not found' }, { status: 404 });
	}

	// ── Delete S3 object ──────────────────────────────────────────────────
	const s3Result = await deleteS3Object(env, share.bucket, share.s3_key);

	// ── Delete D1 row ────────────────────────────────────────────────────
	await deleteShareRow(env, token);

	// ── Audit ─────────────────────────────────────────────────────────────
	await audit(env, {
		ip,
		action: 'delete',
		shareToken: token,
		status: 200,
		detail: {
			filename: share.filename,
			s3Deleted: s3Result.ok,
			admin: true
		}
	});

	return json({ success: true, s3Deleted: s3Result.ok });
};