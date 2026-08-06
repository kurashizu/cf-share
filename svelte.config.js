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
		// cf-share's API is called by third-party clients (curl, sharetube)
		// with arbitrary Origin/Referer. Preserve the Next.js behaviour of
		// not enforcing same-origin on state-changing requests.
		csrf: { checkOrigin: false }
	}
};

export default config;
