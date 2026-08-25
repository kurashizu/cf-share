/**
 * Extract the client IP from a Cloudflare Worker request.
 *
 * Only Cloudflare-set sources are trusted: `request.cf.clientIP`,
 * `cf-connecting-ip` (also set by `wrangler dev`), then the adapter's
 * `getClientAddress()` passed as `fallback`. Client-forgeable headers like
 * `x-forwarded-for` are deliberately NOT consulted — rate limits and quotas
 * key off this value, so honoring spoofable headers would let anyone reset
 * their quota per request.
 */
export function getClientIp(request: Request, fallback?: string): string {
	const cf = (request as Request & { cf?: { clientIP?: string } }).cf;
	if (cf?.clientIP) return cf.clientIP;

	const connecting = request.headers.get("cf-connecting-ip")?.trim();
	if (connecting) return connecting;

	return fallback ?? "0.0.0.0";
}


/** Today's UTC date as `YYYY-MM-DD` (used as partition key for upload_quota). */
export function utcDayKey(now: Date = new Date()): string {
	return now.toISOString().slice(0, 10);
}
