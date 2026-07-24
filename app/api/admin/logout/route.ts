/// <reference path="../../../../cloudflare-env.d.ts" />

import { NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME } from "../../../../lib/admin/auth";
import { serializeCookie } from "../../../../lib/admin/cookie";

export const runtime = "nodejs";

/**
 * POST /api/admin/logout
 *
 * Clears the `cf_admin` cookie. Always succeeds.
 */
export async function POST(): Promise<NextResponse> {
  const cookie = serializeCookie(ADMIN_COOKIE_NAME, "", {
    maxAge: 0,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
  });
  return NextResponse.json(
    { success: true },
    { headers: { "Set-Cookie": cookie } },
  );
}