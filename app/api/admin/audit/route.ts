/// <reference path="../../../../cloudflare-env.d.ts" />

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "../../../../lib/admin/auth";

const PAGE_SIZE = 100;

/**
 * GET /api/admin/audit
 *
 * Query params:
 *   apage   - page number (default: 1)
 *   aq      - search by IP or share token
 *   aaction - filter by action type
 *
 * Returns JSON with audit entries + aggregate stats + available action types.
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
	const page = Math.max(1, parseInt(searchParams.get("apage") ?? "1", 10) || 1);
	const query = (searchParams.get("aq") ?? "").trim();
	const actionFilter = (searchParams.get("aaction") ?? "").trim();
	const offset = (page - 1) * PAGE_SIZE;

	// ── WHERE builder ─────────────────────────────────────────────────────
	const bindings: unknown[] = [];
	const clauses: string[] = [];

	if (actionFilter) {
		const idx = bindings.length + 1;
		clauses.push(`action = ?${idx}`);
		bindings.push(actionFilter);
	}
	if (query) {
		const idx = bindings.length + 1;
		clauses.push(`(ip LIKE ?${idx} OR share_token LIKE ?${idx})`);
		bindings.push(`%${query}%`);
	}
	const whereSQL = clauses.length > 0 ? "WHERE " + clauses.join(" AND ") : "";

	// ── Count ─────────────────────────────────────────────────────────────
	const countResult = await env.DB.prepare(
		`SELECT COUNT(*) AS total FROM audit_log ${whereSQL}`,
	)
		.bind(...bindings)
		.first<{ total: number }>();
	const totalEntries = countResult?.total ?? 0;
	const totalPages = Math.max(1, Math.ceil(totalEntries / PAGE_SIZE));

	// ── Fetch ─────────────────────────────────────────────────────────────
	const dataBindings = [...bindings, PAGE_SIZE, offset];
	const rows = await env.DB.prepare(
		`SELECT id, ts, ip, action, share_token, status, detail_json
		 FROM audit_log ${whereSQL}
		 ORDER BY ts DESC
		 LIMIT ?${bindings.length + 1} OFFSET ?${bindings.length + 2}`,
	)
		.bind(...dataBindings)
		.all();

	// ── Available action types ────────────────────────────────────────────
	const actionTypes = await env.DB.prepare(
		`SELECT DISTINCT action FROM audit_log ORDER BY action`,
	).all<{ action: string }>();
	const actions = (actionTypes.results ?? []).map((r) => r.action);

	// ── Aggregate stats ───────────────────────────────────────────────────
	const agg = await env.DB.prepare(
		`SELECT
		   COUNT(*) AS total,
		   COUNT(DISTINCT ip) AS unique_ips,
		   MAX(ts) AS last_ts
		 FROM audit_log`,
	).first<{ total: number; unique_ips: number; last_ts: number | null }>();

	return NextResponse.json({
		entries: rows.results ?? [],
		actions,
		stats: {
			total: agg?.total ?? 0,
			uniqueIps: agg?.unique_ips ?? 0,
			lastTs: agg?.last_ts ?? null,
		},
		page,
		totalPages,
		totalEntries,
	});
}
