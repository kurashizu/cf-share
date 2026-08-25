import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { createS3Client, bucketName } from '@/lib/s3/client';
import { presignPut } from '@/lib/s3/presign';
import { validateSize, validateContentType, buildS3Key } from '@/lib/s3/policy';
import {
	initiateMultipartUpload,
	shouldUseMultipart,
	type PartPresign
} from '@/lib/s3/multipart';
import { checkRateLimit } from '@/lib/rate-limit/check';
import { getClientIp } from '@/lib/util/ip';
import { audit } from '@/lib/util/audit';
import { requestIsAuthorized } from '@/lib/admin/auth';
import { signUploadGrant } from '@/lib/share/upload-grant';
import { checkPoolCapacity } from '@/lib/share/pool';

interface InitBody {
	filename?: unknown;
	size?: unknown;
	contentType?: unknown;
	ttl?: unknown;
	password?: unknown;
}

interface SingleResponse {
	mode: 'single';
	uploadId: string;
	key: string;
	/** HMAC over (key, size, contentType) — echo back at complete. */
	uploadSig: string;
	url: string;
	headers: { 'Content-Type': string };
	expiresIn: number;
}

interface MultipartResponse {
	mode: 'multipart';
	uploadId: string;
	s3UploadId: string;
	key: string;
	/** HMAC over (key, size, contentType) — echo back at resume/complete. */
	uploadSig: string;
	parts: PartPresign[];
	partSize: number;
	expiresIn: number;
}

type InitResponse = SingleResponse | MultipartResponse;

/**
 * POST /api/upload/init
 *
 * Validates the requested upload, enforces per-IP daily quota, and returns
 * either a presigned PUT URL (single mode) or presigned URLs for each part
 * (multipart mode, for files > 90 MB).
 *
 * The Worker never sees the file bytes — uploads go directly to S3.
 */
export const POST: RequestHandler = async ({ request, platform, getClientAddress }) => {
	const env = platform!.env;
	const ip = getClientIp(request, getClientAddress());

	// Admin bypass: JWT cookie unlocks a higher per-file cap and skips rate
	// limiting + per-IP daily quota + total pool quota. Audit still logs the
	// upload with `via: "admin"` so it's traceable.
	const isAdmin = await requestIsAuthorized(env, request);

	// ── Rate limit (per-IP, per-minute) — skipped for admin ──
	if (!isAdmin) {
		const rl = await checkRateLimit(env, 'UPLOAD_INIT_LIMIT', ip);
		if (!rl.success) {
			await audit(env, {
				ip,
				action: 'init',
				status: 429,
				detail: { reason: 'rate-limit' }
			});
			return json({ error: 'Too Many Requests' }, { status: 429 });
		}
	}

	// ── Parse body ──
	let body: InitBody;
	try {
		body = (await request.json()) as InitBody;
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const filename = typeof body.filename === 'string' ? body.filename.trim() : '';
	if (!filename) {
		return json({ error: 'filename is required' }, { status: 400 });
	}
	if (filename.length > 500) {
		return json({ error: 'filename too long' }, { status: 400 });
	}

	const contentType = validateContentType(body.contentType);
	if (!contentType) {
		return json({ error: 'contentType is required' }, { status: 400 });
	}

	// Admin gets the higher cap; everyone else the standard public cap.
	const maxSize = isAdmin
		? Number(env.MAX_FILE_SIZE_ADMIN ?? env.MAX_FILE_SIZE)
		: Number(env.MAX_FILE_SIZE);
	const size = validateSize(body.size, maxSize);
	if (size === null) {
		return json(
			{ error: `size must be an integer in [1, ${maxSize}]` },
			{ status: 400 }
		);
	}

	// ── TTL (share-link lifetime) — skipped for admin when ttl=0 (no expiry) ──
	const minTtl = Number(env.MIN_SHARE_TTL);
	const maxTtl = Number(env.MAX_SHARE_TTL);
	let ttl = Number(env.MAX_SHARE_TTL); // default = max
	if (body.ttl !== undefined && body.ttl !== null) {
		const requested = Number(body.ttl);
		if (!Number.isFinite(requested)) {
			return json({ error: 'ttl must be a number' }, { status: 400 });
		}
		// Admin can send ttl=0 for "no expiry".
		if (requested === 0 && isAdmin) {
			ttl = 0; // sentinel: stored as expires_at = 0 (never expires)
		} else if (requested < minTtl || requested > maxTtl) {
			return json(
				{ error: `ttl must be in [${minTtl}, ${maxTtl}] seconds` },
				{ status: 400 }
			);
		} else {
			ttl = requested;
		}
	}

	// ── Per-IP daily quota — skipped for admin ──
	if (!isAdmin) {
		const dayKey = new Date().toISOString().slice(0, 10);
		const maxBytes = Number(env.MAX_DAILY_BYTES_PER_IP);
		const maxCount = Number(env.MAX_DAILY_COUNT_PER_IP);

		let quotaRow: { total_bytes: number; count: number } | null = null;
		try {
			quotaRow = await env.DB.prepare(
				`SELECT total_bytes, count FROM upload_quota WHERE ip = ?1 AND day = ?2`
			)
				.bind(ip, dayKey)
				.first<{ total_bytes: number; count: number }>();
		} catch {
			// DB may not be initialized yet; allow through but log.
		}
		if (quotaRow) {
			if (quotaRow.total_bytes + size > maxBytes) {
				await audit(env, {
					ip,
					action: 'init',
					status: 429,
					detail: { reason: 'quota-bytes', quota: quotaRow }
				});
				return json(
					{
						error: `Daily upload limit exceeded (max ${maxBytes} bytes per IP)`
					},
					{ status: 429 }
				);
			}
			if (quotaRow.count + 1 > maxCount) {
				await audit(env, {
					ip,
					action: 'init',
					status: 429,
					detail: { reason: 'quota-count', quota: quotaRow }
				});
				return json(
					{ error: `Daily file count exceeded (max ${maxCount} files per IP)` },
					{ status: 429 }
				);
			}
		}
	}

	// ── Total S3 pool limit (bytes + active-share count) — skipped for admin.
	// The count cap keeps the pool a small fraction of the 4-char token space
	// (36^4 = 1.68M) so fixed-length token generation cannot be starved. Also
	// re-checked at complete so skipping init doesn't bypass it. ──
	if (!isAdmin) {
		const pool = await checkPoolCapacity(env, size);
		if (!pool.ok) {
			await audit(env, {
				ip,
				action: 'init',
				status: 429,
				detail: { reason: pool.reason, requested: size, pool }
			});
			return json(
				{
					error:
						pool.reason === 'total-pool-exceeded'
							? `Total storage pool limit exceeded (max ${pool.maxTotalBytes} bytes across all shares)`
							: `Total share count limit exceeded (max ${pool.maxTotalCount} active shares)`
				},
				{ status: 429 }
			);
		}
	}

	// ── Generate S3 key + signed upload grant ──
	const ephemeralToken = `tmp-${crypto.randomUUID().slice(0, 8)}`;
	const key = buildS3Key({ shareToken: ephemeralToken, filename });
	// Binds (key, size, contentType) so complete/resume can verify the client
	// echoes back exactly what was approved here.
	const uploadSig = await signUploadGrant(env, { key, size, contentType });

	const client = createS3Client(env);
	const expiresIn = Number(env.UPLOAD_URL_TTL);

	// ── Choose upload mode ──
	if (shouldUseMultipart(size)) {
		// ── Multipart upload (large files) ──
		const { uploadId, parts } = await initiateMultipartUpload({
			client,
			bucket: bucketName(env),
			key,
			fileSize: size,
			expiresIn
		});

		// The S3 UploadId is opaque; we correlate with our own uploadId in audit
		const ourUploadId = `ul_${crypto.randomUUID().replace(/-/g, '')}`;

		await audit(env, {
			ip,
			action: 'init',
			status: 200,
			detail: {
				uploadId: ourUploadId,
				s3UploadId: uploadId,
				mode: 'multipart',
				parts: parts.length,
				size,
				contentType,
				filename,
				via: isAdmin ? 'admin' : 'anon'
			}
		});

		const response: MultipartResponse = {
			mode: 'multipart',
			uploadId: ourUploadId,
			s3UploadId: uploadId,
			key,
			uploadSig,
			parts,
			partSize: parts[0]?.size ?? 0,
			expiresIn
		};
		return json(response);
	} else {
		// ── Single PUT (small to medium files) ──
		const url = await presignPut({
			client,
			bucket: bucketName(env),
			key,
			contentType,
			expiresIn
		});

		const uploadId = `ul_${crypto.randomUUID().replace(/-/g, '')}`;

		await audit(env, {
			ip,
			action: 'init',
			status: 200,
			detail: {
				uploadId,
				mode: 'single',
				size,
				contentType,
				filename,
				via: isAdmin ? 'admin' : 'anon'
			}
		});

		const response: SingleResponse = {
			mode: 'single',
			uploadId,
			key,
			uploadSig,
			url,
			headers: { 'Content-Type': contentType },
			expiresIn
		};
		return json(response);
	}
};