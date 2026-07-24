/// <reference path="../../../../cloudflare-env.d.ts" />

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";
import { requestIsAuthorized } from "../../../../lib/admin/auth";

export const runtime = "nodejs";

/**
 * GET /api/admin/me
 *
 * Returns 200 with `{ authenticated: true }` if the caller has a valid
 * admin JWT cookie, otherwise 401.
 *
 * The /admin page uses this on mount to decide whether to show the panel
 * or redirect to /admin/login.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const { env } = await getCloudflareContext();
  if (await requestIsAuthorized(env, request)) {
    return NextResponse.json({ authenticated: true });
  }
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}