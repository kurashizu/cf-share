/// <reference path="./cloudflare-env.d.ts" />

// Custom worker that wraps the OpenNext-generated fetch handler and
// adds a scheduled handler for the daily cleanup cron.
//
// Why: OpenNext only emits a default `fetch` export. We need a
// `scheduled` handler for the cron trigger. The official guidance
// (https://opennext.js.org/cloudflare/howtos/custom-worker) is to
// re-export the default and bolt on additional handlers here.
//
// We also re-export `DOQueueHandler` and `DOShardedTagCache` so the
// DO queue + tag cache keep working. (OpenNext docs: required when
// the app uses the DO Queue and DO Tag Cache.)
// @ts-ignore `.open-next/worker.js` is generated at build time
import { default as openNextHandler } from "./.open-next/worker.js";

// @ts-ignore `.open-next/worker.js` is generated at build time
export { DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";

// Polyfill DOMParser for the CF Worker runtime. AWS SDK v3's XML
// deserializer (used by ListObjectsV2, ListMultipartUploads, etc.)
// requires DOMParser which is unavailable in Workers even with nodejs_compat.
import { DOMParser } from "@xmldom/xmldom";
if (typeof globalThis.DOMParser === "undefined") {
  (globalThis as any).DOMParser = DOMParser;
}

import { runCleanup } from "./lib/s3/cleanup";

export default {
  fetch: openNextHandler.fetch,

  async scheduled(
    event: ScheduledController,
    env: CloudflareEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    const cron = event.cron ?? "unknown";
    const scheduledTime = event.scheduledTime ?? Date.now();
    console.log("[cron] cleanup tick", { cron, scheduledTime });

    try {
      const result = await runCleanup(env);
      console.log("[cron] cleanup complete", result);
    } catch (err) {
      console.error("[cron] cleanup failed", {
        cron,
        err: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      // Re-throw so the platform records the failure and retries next
      // scheduled run (CF cron does not auto-retry on the same tick).
      throw err;
    }

    // ctx is unused but the type signature requires it
    void ctx;
  },
} satisfies ExportedHandler<CloudflareEnv>;
