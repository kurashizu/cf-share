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
		csrf: { checkOrigin: false }
	}
};

export default config;
