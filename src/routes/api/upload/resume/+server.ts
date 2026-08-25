import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { createS3Client, bucketName } from '@/lib/s3/client';
import {
	presignParts,
	shouldUseMultipart,
	computeMissingParts,
	type PartPresign,
	MULTIPART_PART_SIZE
} from '@/lib/s3/multipart';
import { checkRateLimit } from '@/lib/rate-limit/check';
import { getClientIp } from '@/lib/util/ip';
import { audit } from '@/lib/util/audit';
import { verifyUploadGrant, isValidUploadKey } from '@/lib/share/upload-grant';

interface ResumeBody {
	s3UploadId?: unknown;
	key?: unknown;
	size?: unknown;
	contentType?: unknown;
	/** Grant signature issued by /api/upload/init — required. */
	uploadSig?: unknown;
	/** Part numbers the client already PUT successfully (from localStorage). */
	uploadedPartNumbers?: unknown;
}

interface ResumeResponse {
	mode: 'multipart';
	uploadId: string;
	s3UploadId: string;
	key: string;
	/** Echoed back so the client can pass it to complete. */
	uploadSig: string;
	/** Presigned URLs for the parts still needed. */
	parts: PartPresign[];
	partSize: number;
	expiresIn: number;
}

/**
 * POST /api/upload/resume
 *
 * Body: { s3UploadId, key, size, uploadedPartNumbers: number[] }
 *
 * Returns fresh presigned URLs for the parts still missing from S3.
 *
 * Why client-side state instead of server-side ListParts:
 *   The S3 endpoint behind the Cloudflare WAF rejects `ListParts` requests
 *   from the AWS SDK (CF error 1010 on the SDK's request signature). Other
 *   S3 commands work fine. The client tracks uploaded parts in localStorage
 *   (see src/lib/client/resume.ts) and ships them with this request. If
 *   localStorage is wiped, the user starts a fresh upload and the abandoned
 *   session is reaped by the cleanup cron.
 */
export const POST: RequestHandler = async ({ request, platform, getClientAddress }) => {
	const env = platform!.env;
	const ip = getClientIp(request, getClientAddress());

	try {
		return await handleResume(request, env, ip);
	} catch (err) {
		console.error('[resume] unhandled error', {
			err: err instanceof Error ? err.message : String(err),
			stack: err instanceof Error ? err.stack : undefined
		});
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};

async function handleResume(
	request: Request,
	env: CloudflareEnv,
	ip: string
): Promise<Response> {
	const rl = await checkRateLimit(env, 'UPLOAD_INIT_LIMIT', ip);
	if (!rl.success) {
		await audit(env, {
			ip,
			action: 'init',
			status: 429,
			detail: { reason: 'rate-limit', source: 'resume' }
		});
		return json({ error: 'Too Many Requests' }, { status: 429 });
	}

	let body: ResumeBody;
	try {
		body = (await request.json()) as ResumeBody;
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const s3UploadId =
		typeof body.s3UploadId === 'string' ? body.s3UploadId.trim() : '';
	const key = typeof body.key === 'string' ? body.key.trim() : '';
	const size = typeof body.size === 'number' ? body.size : -1;
	const contentType =
		typeof body.contentType === 'string' ? body.contentType.trim() : '';
	const uploadSig =
		typeof body.uploadSig === 'string' ? body.uploadSig : '';

	if (!s3UploadId || !key || !contentType || size < 1) {
		return json(
			{ error: 's3UploadId, key, contentType, and positive size are required' },
			{ status: 400 }
		);
	}

	// Only re-sign part URLs for uploads this server actually approved at
	// init — otherwise resume would presign writes to arbitrary keys.
	if (
		!isValidUploadKey(key) ||
		!(await verifyUploadGrant(env, uploadSig, { key, size, contentType }))
	) {
		await audit(env, {
			ip,
			action: 'init',
			status: 403,
			detail: { reason: 'invalid-upload-grant', source: 'resume', key, size }
		});
		return json(
			{ error: 'Invalid or missing uploadSig for this key/size/contentType' },
			{ status: 403 }
		);
	}

	if (!shouldUseMultipart(size)) {
		// Single-PUT uploads can't be resumed — there's nothing to skip.
		return json(
			{
				error:
					'resume is only valid for multipart uploads; restart with /api/upload/init'
			},
			{ status: 400 }
		);
	}

	// Validate uploadedPartNumbers — must be an array of positive integers.
	const uploadedPartNumbers: number[] = [];
	if (Array.isArray(body.uploadedPartNumbers)) {
		for (const n of body.uploadedPartNumbers) {
			if (
				typeof n === 'number' &&
				Number.isInteger(n) &&
				n >= 1 &&
				n <= 100_000
			) {
				uploadedPartNumbers.push(n);
			}
		}
	}

	const client = createS3Client(env);
	const expiresIn = Number(env.UPLOAD_URL_TTL);

	const missing = computeMissingParts(size, new Set(uploadedPartNumbers));

	// Presign only the missing parts.
	let parts: PartPresign[] = [];
	if (missing.length > 0) {
		try {
			parts = await presignParts({
				client,
				bucket: bucketName(env),
				key,
				uploadId: s3UploadId,
				partNumbers: missing,
				expiresIn
			});
		} catch (err) {
			await audit(env, {
				ip,
				action: 'init',
				status: 500,
				detail: {
					reason: 'resume-presign-failed',
					key,
					s3UploadId,
					missing: missing.length,
					error: err instanceof Error ? err.message : String(err)
				}
			});
			return json({ error: 'Failed to sign part URLs' }, { status: 500 });
		}
	}

	// Fill in the actual byte size for each part so the client can slice
	// the file correctly without needing to compute it itself.
	const partSize = MULTIPART_PART_SIZE;
	for (const p of parts) {
		const offset = (p.partNumber - 1) * partSize;
		p.size = Math.min(partSize, size - offset);
	}

	await audit(env, {
		ip,
		action: 'init',
		status: 200,
		detail: {
			mode: 'resume',
			s3UploadId,
			key,
			size,
			totalParts: Math.ceil(size / partSize),
			alreadyUploaded: uploadedPartNumbers.length,
			stillNeeded: parts.length
		}
	});

	const ourUploadId = `rs_${crypto.randomUUID().replace(/-/g, '')}`;

	const response: ResumeResponse = {
		mode: 'multipart',
		uploadId: ourUploadId,
		s3UploadId,
		key,
		uploadSig,
		parts,
		partSize,
		expiresIn
	};
	return json(response);
}