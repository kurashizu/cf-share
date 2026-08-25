import type { Handle } from '@sveltejs/kit';

/**
 * Baseline security headers for every Worker-rendered response (pages and
 * API routes alike; static assets get theirs from `_headers`).
 *
 * The Content-Security-Policy itself is configured in `svelte.config.js`
 * (kit.csp) so SvelteKit can nonce its own inline hydration script.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);

	// User-uploaded files pass through /p/:token with their original
	// Content-Type — never let browsers sniff their way around it.
	response.headers.set('X-Content-Type-Options', 'nosniff');
	// The app has no legitimate embedding use; block clickjacking.
	// (frame-ancestors in the CSP is the modern equivalent; this covers
	// older browsers.)
	response.headers.set('X-Frame-Options', 'DENY');
	// Don't leak share URLs (which contain tokens) to external sites.
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set(
		'Permissions-Policy',
		'camera=(), microphone=(), geolocation=()'
	);

	return response;
};
