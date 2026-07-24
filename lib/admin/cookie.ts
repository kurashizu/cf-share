/**
 * Minimal Cookie header parser/serializer.
 *
 * We avoid pulling in a `cookie` npm dep just for two helpers used by the
 * admin auth flow.
 */

export function parseCookieHeader(
  header: string | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const name = trimmed.slice(0, eq).trim();
    const raw = trimmed.slice(eq + 1).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(raw);
    } catch {
      // Malformed encoding — skip this cookie.
    }
  }
  return out;
}

export interface SerializeCookieOptions {
  /** Max-Age in seconds. Takes precedence over Expires when both are set. */
  maxAge?: number;
  expires?: Date;
  path?: string;
  domain?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export function serializeCookie(
  name: string,
  value: string,
  opts: SerializeCookieOptions = {},
): string {
  const segments: string[] = [`${name}=${encodeURIComponent(value)}`];
  if (opts.maxAge !== undefined) segments.push(`Max-Age=${opts.maxAge}`);
  if (opts.expires) segments.push(`Expires=${opts.expires.toUTCString()}`);
  segments.push(`Path=${opts.path ?? "/"}`);
  if (opts.domain) segments.push(`Domain=${opts.domain}`);
  if (opts.secure ?? true) segments.push("Secure");
  if (opts.httpOnly ?? true) segments.push("HttpOnly");
  const same = opts.sameSite ?? "Lax";
  segments.push(`SameSite=${same}`);
  return segments.join("; ");
}