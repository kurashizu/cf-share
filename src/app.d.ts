/// <reference path="../cloudflare-env.d.ts" />

declare global {
	/** Short commit hash baked in at build time by vite.config.ts. */
	const __BUILD_COMMIT__: string;

	namespace App {
		interface Platform {
			env: CloudflareEnv;
			context: ExecutionContext;
			ctx: ExecutionContext;
			cf: IncomingRequestCfProperties;
		}
	}
}

export {};
