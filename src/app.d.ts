/// <reference path="../cloudflare-env.d.ts" />

declare global {
	namespace App {
		interface Platform {
			env: CloudflareEnv;
			context: ExecutionContext;
			ctx: ExecutionContext;
			caches: CacheStorage;
			cf: IncomingRequestCfProperties;
		}
	}
}

export {};
