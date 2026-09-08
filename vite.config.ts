import { execSync } from 'node:child_process';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

/** Short commit hash baked in at build time, for footer attribution. */
function buildCommitHash(): string {
	try {
		return execSync('git rev-parse --short HEAD').toString().trim();
	} catch {
		return 'unknown';
	}
}

export default defineConfig({
	plugins: [sveltekit(), tailwindcss()],
	define: {
		__BUILD_COMMIT__: JSON.stringify(buildCommitHash())
	}
});
