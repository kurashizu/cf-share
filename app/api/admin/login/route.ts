/// <reference path="../../../../cloudflare-env.d.ts" />

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE_NAME,
  passwordsMatch,
  signAdminJwt,
} from "../../../../lib/admin/auth";
import { serializeCookie } from "../../../../lib/admin/cookie";
import { audit } from "../../../../lib/util/audit";
import { getClientIp } from "../../../../lib/util/ip";

export const runtime = "nodejs";

/**
 * POST /api/admin/login
 *
 * Body: `{ password: string }`
 *
 * On success: returns 200 with the JWT (also set as an HttpOnly cookie) and
 * the cookie's expiry timestamp. On failure: returns 401.
 *
 * The JWT is stored as the `cf_admin` HttpOnly cookie so the browser
 * automatically sends it on every subsequent same-origin request — that's
 * what makes the admin upload flow work without any extra client wiring.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const { env } = await getCloudflareContext();
  const ip = getClientIp(request);

  let body: { password?: unknown };
  try {
    body = (await request.json()) as { password?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const submitted = typeof body.password === "string" ? body.password : "";
  if (!submitted) {
    return NextResponse.json(
      { error: "Password is required" },
      { status: 400 },
    );
  }

  if (!passwordsMatch(submitted, env.ADMIN_PASSWORD)) {
    // Log failed attempts so brute force is detectable from the audit log.
    await audit(env, {
      ip,
      action: "admin_view",
      status: 401,
      detail: { reason: "login-failed" },
    });
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const { token, expiresAt } = await signAdminJwt(env);
  const ttl = Math.max(1, expiresAt - Math.floor(Date.now() / 1000));

  await audit(env, {
    ip,
    action: "admin_view",
    status: 200,
    detail: { reason: "login-success" },
  });

  const cookie = serializeCookie(ADMIN_COOKIE_NAME, token, {
    maxAge: ttl,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
  });

  return NextResponse.json(
    { success: true, expiresAt },
    { headers: { "Set-Cookie": cookie } },
  );
}