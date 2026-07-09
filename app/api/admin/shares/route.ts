/// <reference path="../../../../cloudflare-env.d.ts" />

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "../../../../lib/admin/auth";

const PAGE_SIZE = 50;

/**
 * GET /api/admin/shares
 *
 * Query params:
 *   page   - page number (default: 1)
 *   q      - search by filename or token
 *   all    - if "1", include expired shares (default: active only)
 *
 * Returns JSON with shares list + aggregate stats.
 * Protected by HTTP Basic Auth (S3 credentials).
 */
export async function GET(request: NextRequest) {
	const { env } = await getCloudflareContext();

	// ── Auth ──────────────────────────────────────────────────────────────
	if (!isAuthorized(env, request.headers.get("authorization"))) {
		return NextResponse.json(
			{ error: "Unauthorized" },
			{
				status: 401,
				headers: { "WWW-Authenticate": 'Basic realm="Admin Panel"' },
			},
		);
	}

	// ── Params ────────────────────────────────────────────────────────────
	const { searchParams } = request.nextUrl;
	const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
	const query = (searchParams.get("q") ?? "").trim();
	const showAll = searchParams.get("all") === "1";
	const now = Date.now();
	const offset = (page - 1) * PAGE_SIZE;

	// ── WHERE builder ─────────────────────────────────────────────────────
	const bindings: unknown[] = [];
	const clauses: string[] = [];

	if (query) {
		clauses.push("(filename LIKE ?1 OR token LIKE ?1)");
		bindings.push(`%${query}%`);
	}
	if (!showAll) {
		const idx = bindings.length + 1;
		clauses.push(`expires_at > ?${idx}`);
		bindings.push(now);
	}
	const whereSQL = clauses.length > 0 ? "WHERE " + clauses.join(" AND ") : "";

	// ── Count ─────────────────────────────────────────────────────────────
	const countResult = await env.DB.prepare(
		`SELECT COUNT(*) AS total FROM shares ${whereSQL}`,
	)
		.bind(...bindings)
		.first<{ total: number }>();
	const totalShares = countResult?.total ?? 0;
	const totalPages = Math.max(1, Math.ceil(totalShares / PAGE_SIZE));

	// ── Fetch ─────────────────────────────────────────────────────────────
	const dataBindings = [...bindings, PAGE_SIZE, offset];
	const rows = await env.DB.prepare(
		`SELECT token, bucket, s3_key, filename, size_bytes, content_type,
		        expires_at, created_at, created_ip, user_agent,
		        download_count, last_download_at
		 FROM shares ${whereSQL}
		 ORDER BY created_at DESC
		 LIMIT ?${bindings.length + 1} OFFSET ?${bindings.length + 2}`,
	)
		.bind(...dataBindings)
		.all();

	// ── Stats ─────────────────────────────────────────────────────────────
	const stats = await env.DB.prepare(
		`SELECT
		   COUNT(*) AS total,
		   SUM(CASE WHEN expires_at > ?1 THEN 1 ELSE 0 END) AS active,
		   SUM(CASE WHEN expires_at <= ?1 THEN 1 ELSE 0 END) AS expired,
		   SUM(size_bytes) AS total_bytes,
		   SUM(CASE WHEN expires_at > ?1 THEN size_bytes ELSE 0 END) AS active_bytes
		 FROM shares`,
	)
		.bind(now)
		.first();

	return NextResponse.json({
		shares: rows.results ?? [],
		stats: {
			total: stats?.total ?? 0,
			active: stats?.active ?? 0,
			expired: stats?.expired ?? 0,
			totalBytes: stats?.total_bytes ?? 0,
			activeBytes: stats?.active_bytes ?? 0,
		},
		page,
		totalPages,
		totalShares,
	});
}
