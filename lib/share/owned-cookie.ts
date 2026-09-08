/**
 * `cf_owned` cookie — the list of share tokens this browser has minted,
 * each paired with the delete-grant signature from delete-grant.ts. Lets an
 * anonymous uploader revoke their own shares later without an account.
 *
 * Shape (JSON, HttpOnly cookie): [{ t: token, s: sig }, ...]
 *
 * Capped at MAX_OWNED_ENTRIES so the cookie stays well under the ~4KB
 * per-cookie budget; oldest entries are evicted first (FIFO) since those
 * are also the ones closest to expiring/being cleaned up anyway.
 */

import { parseCookieHeader, serializeCookie } from "../admin/cookie";

export const OWNED_COOKIE_NAME = "cf_owned";
const MAX_OWNED_ENTRIES = 50;

export interface OwnedEntry {
  t: string;
  s: string;
}

/** Parse the `cf_owned` cookie from a request's Cookie header. Never throws. */
export function parseOwnedCookie(cookieHeader: string | null): OwnedEntry[] {
  const raw = parseCookieHeader(cookieHeader)[OWNED_COOKIE_NAME];
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is OwnedEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as OwnedEntry).t === "string" &&
        typeof (e as OwnedEntry).s === "string",
    );
  } catch {
    return [];
  }
}

/** Look up the signature this cookie holds for a given token, or null. */
export function findOwnedSig(
  cookieHeader: string | null,
  token: string,
): string | null {
  const entries = parseOwnedCookie(cookieHeader);
  return entries.find((e) => e.t === token)?.s ?? null;
}

/**
 * Build the `Set-Cookie` header value that appends a newly-minted
 * {token, sig} pair to whatever the request already carried, evicting the
 * oldest entries if the list would exceed MAX_OWNED_ENTRIES.
 */
export function buildOwnedCookieHeader(
  existingCookieHeader: string | null,
  entry: OwnedEntry,
  opts: { secure: boolean; maxAgeSeconds: number },
): string {
  const existing = parseOwnedCookie(existingCookieHeader).filter(
    (e) => e.t !== entry.t,
  );
  const next = [...existing, entry].slice(-MAX_OWNED_ENTRIES);
  return serializeCookie(OWNED_COOKIE_NAME, JSON.stringify(next), {
    maxAge: opts.maxAgeSeconds,
    httpOnly: true,
    secure: opts.secure,
    sameSite: "Lax",
  });
}

/**
 * Build the `Set-Cookie` header value that removes a single token from the
 * owned list (used after a successful self-delete).
 */
export function buildOwnedCookieHeaderWithout(
  existingCookieHeader: string | null,
  token: string,
  opts: { secure: boolean; maxAgeSeconds: number },
): string {
  const next = parseOwnedCookie(existingCookieHeader).filter(
    (e) => e.t !== token,
  );
  return serializeCookie(OWNED_COOKIE_NAME, JSON.stringify(next), {
    maxAge: opts.maxAgeSeconds,
    httpOnly: true,
    secure: opts.secure,
    sameSite: "Lax",
  });
}
