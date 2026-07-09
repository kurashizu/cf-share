/// <reference path="../../../../cloudflare-env.d.ts" />

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextRequest, NextResponse } from "next/server";
import { deleteS3Object, deleteShareRow } from "../../../../lib/s3/cleanup";
import { audit } from "../../../../lib/util/audit";
import { getClientIp } from "../../../../lib/util/ip";

/* ------------------------------------------------------------------ */
/*  Auth helper                                                       */
/* ------------------------------------------------------------------ */

function parseBasicAuth(
	header: string | null,
): { user: string; pass: string } | null {
	if (!header || !header.startsWith("Basic ")) return null;
	try {
		const raw = atob(header.slice(6));
		const colon = raw.indexOf(":");
		if (colon === -1) return null;
		return { user: raw.slice(0, colon), pass: raw.slice(colon + 1) };
	} catch {
		return null;
	}
}

/**
 * DELETE /api/admin/delete?token=XXXX
 *
 * Deletes a single share: removes the S3 object and the D1 row.
 * Protected by HTTP Basic Auth using S3 credentials.
 * Logs the action to audit_log.
 */
export async function DELETE(request: NextRequest) {
	const { env } = await getCloudflareContext();

	// ── Auth ──────────────────────────────────────────────────────────────
	const creds = parseBasicAuth(request.headers.get("authorization"));
	if (
		!creds ||
		creds.user !== env.S3_ACCESS_KEY_ID ||
		creds.pass !== env.S3_SECRET_ACCESS_KEY
	) {
		return NextResponse.json(
			{ error: "Unauthorized" },
			{
				status: 401,
				headers: { "WWW-Authenticate": 'Basic realm="Admin Panel"' },
			},
		);
	}

	// ── Validate ──────────────────────────────────────────────────────────
	const token = request.nextUrl.searchParams.get("token");
	if (!token || !/^[0-9A-Z]{4,6}$/.test(token)) {
		return NextResponse.json({ error: "Invalid token" }, { status: 400 });
	}

	const ip = getClientIp(request);

	// ── Fetch share ───────────────────────────────────────────────────────
	const share = await env.DB.prepare(
		`SELECT bucket, s3_key, filename FROM shares WHERE token = ?1 LIMIT 1`,
	)
		.bind(token)
		.first<{ bucket: string; s3_key: string; filename: string }>();

	if (!share) {
		return NextResponse.json({ error: "Share not found" }, { status: 404 });
	}

	// ── Delete S3 object ──────────────────────────────────────────────────
	const s3Result = await deleteS3Object(env, share.bucket, share.s3_key);

	// ── Delete D1 row ────────────────────────────────────────────────────
	await deleteShareRow(env, token);

	// ── Audit ─────────────────────────────────────────────────────────────
	await audit(env, {
		ip,
		action: "delete",
		shareToken: token,
		status: 200,
		detail: {
			filename: share.filename,
			s3Deleted: s3Result.ok,
			admin: true,
		},
	});

	return NextResponse.json({ success: true, s3Deleted: s3Result.ok });
}
