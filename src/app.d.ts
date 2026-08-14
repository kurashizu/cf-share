/// <reference path="../cloudflare-env.d.ts" />

declare global {
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
