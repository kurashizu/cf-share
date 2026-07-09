/// <reference path="../../cloudflare-env.d.ts" />

/**
 * Parse HTTP Basic Authorization header into user/pass.
 * Returns null if the header is missing, malformed, or not Basic scheme.
 */
export function parseBasicAuth(
	header: string | null,
): { user: string; pass: string } | null {
	if (!header || !header.startsWith("Basic ")) return null;
	try {
		const raw = atob(header.slice(6));
		const colon = raw.indexOf(":");
		if (colon === -1) return null;
		return { user: raw.slice(0, colon), pass: raw.slice(colon + 1) };
	} catch {
		return null;
	}
}

/**
 * Verify that the request is authorized with S3 credentials.
 * Returns `true` if the Authorization header matches env config.
 */
export function isAuthorized(
	env: { S3_ACCESS_KEY_ID: string; S3_SECRET_ACCESS_KEY: string },
	authHeader: string | null,
): boolean {
	const creds = parseBasicAuth(authHeader);
	if (!creds) return false;
	return (
		creds.user === env.S3_ACCESS_KEY_ID &&
		creds.pass === env.S3_SECRET_ACCESS_KEY
	);
}
