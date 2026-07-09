import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";
import { runCleanup } from "@/lib/s3/cleanup";

export const runtime = "nodejs";

/**
 * Manual trigger for the daily cleanup job.
 *
 * Two ways to invoke:
 *   1. Cloudflare cron tick (registered via `triggers.crons` in wrangler.jsonc)
 *      — handled by custom-worker.ts, hits the S3/D1 logic directly.
 *   2. HTTP request with the `X-Cron-Secret` header matching `CRON_SECRET`
 *      — used for manual testing from curl or external schedulers.
 *
 * The HTTP path is also useful as a fallback if the cron trigger ever
 * fails; the same `runCleanup` is invoked, so behaviour is identical.
 */
async function handle(request: Request): Promise<NextResponse> {
	const { env } = await getCloudflareContext();

	const provided = request.headers.get("x-cron-secret");
	const expected = (env as unknown as { CRON_SECRET?: string }).CRON_SECRET;
	if (!expected) {
		return NextResponse.json(
			{ error: "CRON_SECRET not configured" },
			{ status: 503 },
		);
	}
	if (provided !== expected) {
		return NextResponse.json({ error: "unauthorized" }, { status: 401 });
	}

	const result = await runCleanup(env as unknown as CloudflareEnv);
	return NextResponse.json({ ok: true, ...result });
}

export const GET = handle;
export const POST = handle;
