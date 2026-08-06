import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { runCleanup } from '@/lib/s3/cleanup';

/**
 * Manual trigger for the cleanup job.
 *
 * Two ways to invoke:
 *   1. Cloudflare cron tick (registered via `triggers.crons` in wrangler.jsonc)
 *      — handled by the `scheduled` handler in `custom-worker.ts`, which calls
 *      `runCleanup` directly.
 *   2. HTTP request with the `X-Cron-Secret` header matching `CRON_SECRET`
 *      — used for manual testing from curl or external schedulers.
 */
const handle: RequestHandler = async ({ request, platform }) => {
	const env = platform!.env!;

	const provided = request.headers.get('x-cron-secret');
	const expected = (env as unknown as { CRON_SECRET?: string }).CRON_SECRET;
	if (!expected) {
		return json({ error: 'CRON_SECRET not configured' }, { status: 503 });
	}
	if (provided !== expected) {
		return json({ error: 'unauthorized' }, { status: 401 });
	}

	const result = await runCleanup(env);
	return json({ ok: true, ...result });
};

export const GET = handle;
export const POST = handle;