/** Maximum object size eligible for the Worker-proxied link. */
export const DEFAULT_PROXY_MAX_FILE_SIZE = 2 * 1024 * 1024;

/**
 * Read the proxy threshold from Wrangler env, falling back to 2 MiB when the
 * variable is missing or invalid. A value of 0 disables proxied links.
 */
export function proxyMaxFileSize(env: { PROXY_MAX_FILE_SIZE?: string }): number {
	const configured = Number(env.PROXY_MAX_FILE_SIZE);
	if (Number.isSafeInteger(configured) && configured >= 0) return configured;
	return DEFAULT_PROXY_MAX_FILE_SIZE;
}

export function canProxyFile(
	env: { PROXY_MAX_FILE_SIZE?: string },
	sizeBytes: number,
	hasPassword: boolean
): boolean {
	return !hasPassword && sizeBytes <= proxyMaxFileSize(env);
}
