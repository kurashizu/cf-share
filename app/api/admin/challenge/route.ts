/// <reference path="../../../../cloudflare-env.d.ts" />

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "../../../../lib/admin/auth";

/**
 * GET /api/admin/challenge?redirect=/admin
 *
 * Returns 401 with WWW-Authenticate to trigger the browser's native Basic
 * Auth dialog. If the request already carries valid credentials, redirects
 * to the `redirect` query parameter (default: /admin).
 *
 * Flow:
 *   1. Admin page (client component) detects 401 on data fetch
 *   2. Redirects here → browser shows login dialog
 *   3. User submits credentials → browser retries here with auth header
 *   4. We validate, redirect back to /admin → browser now sends auth on all
 *      same-origin requests for this realm
 */
export async function GET(request: NextRequest) {
	const { env } = await getCloudflareContext();

	const authHeader = request.headers.get("authorization");
	const redirectUrl = request.nextUrl.searchParams.get("redirect") || "/admin";

	if (isAuthorized(env, authHeader)) {
		// Valid credentials → send them back to the admin page
		return NextResponse.redirect(new URL(redirectUrl, request.url));
	}

	// No (or invalid) credentials → challenge the browser
	return new NextResponse("Authentication required", {
		status: 401,
		headers: {
			"WWW-Authenticate": 'Basic realm="Admin Panel"',
			"Content-Type": "text/plain",
		},
	});
}
