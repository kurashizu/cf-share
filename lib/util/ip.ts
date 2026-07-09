/**
 * Extract the client IP from a Cloudflare Worker request.
 *
 * On Cloudflare, `request.cf?.clientIP` (preferred) or `cf-connecting-ip`
 * header are both reliable. We fall back through the headers that Cloudflare
 * itself sets so this also works behind `wrangler dev` (which uses
 * `cf-connecting-ip` for the local client).
 */
export function getClientIp(request: Request): string {
	const cf = (request as Request & { cf?: { clientIP?: string } }).cf;
	if (cf?.clientIP) return cf.clientIP;

	const headers = request.headers;
	const candidates = [
		"cf-connecting-ip",
		"x-forwarded-for",
		"x-real-ip",
		"true-client-ip",
	];
	for (const h of candidates) {
		const v = headers.get(h);
		if (v) {
			// x-forwarded-for may be a comma-separated list — first is the client.
			const first = v.split(",")[0]?.trim();
			if (first) return first;
		}
	}
	return "0.0.0.0";
}

/** Today's UTC date as `YYYY-MM-DD` (used as partition key for upload_quota). */
export function utcDayKey(now: Date = new Date()): string {
	return now.toISOString().slice(0, 10);
}
