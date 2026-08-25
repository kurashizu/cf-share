import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		alias: {
			'@': './'
		},
		// The API is called by third-party clients (curl, sharetube) with
		// arbitrary Origin/Referer, so state-changing requests do not enforce
		// same-origin CSRF checks.
		csrf: { trustedOrigins: ['*'] },
		// CSP for rendered pages. SvelteKit nonces its own inline hydration
		// script under mode "auto". connect-src includes the S3 endpoint
		// because uploads PUT directly to presigned URLs from the browser
		// (keep in sync with lib/config/app.ts S3_PUBLIC_ENDPOINT).
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'data:'],
				'connect-src': ['self', 'https://s3api.022025.xyz'],
				'object-src': ['none'],
				'base-uri': ['self'],
				'form-action': ['self'],
				'frame-ancestors': ['none']
			}
		}
	}
};

export default config;
