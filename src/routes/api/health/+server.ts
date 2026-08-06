import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ platform }) => {
	const env = platform!.env;
	try {
		// Probe D1 to confirm the binding is alive.
		let dbOk = false;
		try {
			const r = await env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
			dbOk = r?.ok === 1;
		} catch {
			dbOk = false;
		}

		return json({
			status: 'ok',
			db: dbOk,
			s3: {
				endpoint: env.S3_ENDPOINT,
				bucket: env.S3_BUCKET,
				region: env.S3_REGION
			},
			limits: {
				maxFileSize: env.MAX_FILE_SIZE,
				maxShareTtl: env.MAX_SHARE_TTL,
				maxDailyBytesPerIp: env.MAX_DAILY_BYTES_PER_IP,
				maxDailyCountPerIp: env.MAX_DAILY_COUNT_PER_IP
			}
		});
	} catch (err) {
		return json(
			{ status: 'error', error: err instanceof Error ? err.message : String(err) },
			{ status: 500 }
		);
	}
};