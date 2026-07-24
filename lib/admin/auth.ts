/// <reference path="../../cloudflare-env.d.ts" />

/**
 * Admin authentication via short-lived JWT stored in an HttpOnly cookie.
 *
 * The flow:
 *   1. Admin visits /admin and the page calls GET /api/admin/me.
 *   2. If no valid cookie, /api/admin/me returns 401 and the page redirects
 *      to /admin/login.
 *   3. /admin/login submits the password to POST /api/admin/login, which
 *      verifies it against env.ADMIN_PASSWORD and, on success, signs a JWT
 *      and sets it as the `cf_admin` cookie.
 *   4. Subsequent same-origin fetch calls automatically include the cookie
 *      (default `credentials: "same-origin"`), so requestIsAuthorized() can
 *      verify the JWT and return true without any explicit headers on the
 *      client.
 *
 * Why JWT instead of Basic Auth:
 *   - Basic Auth credentials cached by the browser are NOT auto-attached to
 *     JS-initiated fetch() calls, which meant the upload flow's init/complete
 *     requests fell through to the anon path and rejected ttl=0.
 *   - HttpOnly cookie + JWT is browser-native: cookies travel on every same-
 *     origin fetch by default, so the upload flow works without extra plumbing.
 *   - Decoupling admin auth from the S3 credentials means rotating either
 *     secret independently is safe.
 */

import { parseCookieHeader } from "./cookie";

export const ADMIN_COOKIE_NAME = "cf_admin";

/**
 * JWT payload for admin sessions. Keep it small — the cookie size budget
 * matters when every request carries it.
 */
export interface AdminClaims {
  /** Subject — always "admin" for now. */
  sub: "admin";
  /** Issued-at (seconds since epoch). */
  iat: number;
  /** Expiry (seconds since epoch). */
  exp: number;
}

interface AdminEnv {
  ADMIN_PASSWORD: string;
  ADMIN_JWT_SECRET: string;
  ADMIN_JWT_TTL_SECONDS?: string;
}

/* ── Base64URL helpers ─────────────────────────────────────────────── */

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? 0 : 4 - (s.length % 4);
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function utf8Encode(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

function utf8Decode(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}

/* ── HMAC-SHA256 (via Web Crypto) ──────────────────────────────────── */

/**
 * Derive the HMAC key from the configured secret. We accept arbitrary-length
 * secrets and hash them down to 32 bytes so callers don't have to remember
 * to pre-pad.
 */
async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    utf8Encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function hmacSign(
  secret: string,
  data: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, utf8Encode(data));
  return new Uint8Array(sig);
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ── Public API ────────────────────────────────────────────────────── */

/**
 * Sign a JWT for the admin session. The token is HS256, payload = AdminClaims.
 * Returns the compact JWS string (`header.payload.signature`).
 */
export async function signAdminJwt(
  env: AdminEnv,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<{ token: string; expiresAt: number }> {
  const ttl = Number(env.ADMIN_JWT_TTL_SECONDS ?? 8 * 3600);
  const exp = nowSeconds + ttl;
  const header = { alg: "HS256", typ: "JWT" };
  const payload: AdminClaims = { sub: "admin", iat: nowSeconds, exp };
  const headerB64 = base64UrlEncode(utf8Encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(utf8Encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = await hmacSign(env.ADMIN_JWT_SECRET, signingInput);
  const sigB64 = base64UrlEncode(sig);
  return { token: `${signingInput}.${sigB64}`, expiresAt: exp };
}

/**
 * Verify a JWT and return its claims on success, or null on any failure
 * (bad signature, malformed, expired).
 */
export async function verifyAdminJwt(
  env: AdminEnv,
  token: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<AdminClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  let signingInput: string;
  try {
    signingInput = `${headerB64}.${payloadB64}`;
  } catch {
    return null;
  }
  const key = await importHmacKey(env.ADMIN_JWT_SECRET);
  // Re-derive the expected signature and compare in constant time.
  const computed = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, utf8Encode(signingInput)),
  );
  const provided = base64UrlDecode(sigB64);
  if (!timingSafeEqualBytes(provided, computed)) return null;

  let claims: AdminClaims;
  try {
    claims = JSON.parse(utf8Decode(base64UrlDecode(payloadB64))) as AdminClaims;
  } catch {
    return null;
  }
  if (claims.sub !== "admin") return null;
  if (typeof claims.exp !== "number" || claims.exp <= nowSeconds) return null;
  return claims;
}

function timingSafeEqualBytes(
  a: Uint8Array<ArrayBuffer>,
  b: Uint8Array<ArrayBuffer>,
): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/* ── Request helpers ───────────────────────────────────────────────── */

/**
 * Verify that the incoming request carries a valid admin JWT cookie.
 * Returns true if so, false otherwise.
 *
 * Replaces the old HTTP Basic Auth path entirely.
 */
export async function requestIsAuthorized(
  env: AdminEnv,
  request: Request,
): Promise<boolean> {
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const token = cookies[ADMIN_COOKIE_NAME];
  if (!token) return false;
  const claims = await verifyAdminJwt(env, token);
  return claims !== null;
}

/**
 * Constant-time string compare for the password check. We don't use
 * crypto.timingSafeEqual because we already implemented it above for strings.
 */
export function passwordsMatch(submitted: string, expected: string): boolean {
  return timingSafeEqualString(submitted, expected);
}