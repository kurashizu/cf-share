import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createS3Client, bucketName } from '@/lib/s3/client';
import {
	completeMultipartUpload,
	abortMultipartUpload,
	type CompletedPart
} from '@/lib/s3/multipart';
import { checkRateLimit } from '@/lib/rate-limit/check';
import { getClientIp, utcDayKey } from '@/lib/util/ip';
import { audit } from '@/lib/util/audit';
import { createShare, incrementQuota, readQuota } from '@/lib/share/store';
import { hashPassword, isValidPassword } from '@/lib/share/password';
import { requestIsAuthorized } from '@/lib/admin/auth';

interface CompleteBody {
	mode?: unknown;
	uploadId?: unknown;
	s3UploadId?: unknown;
	key?: unknown;
	filename?: unknown;
	size?: unknown;
	contentType?: unknown;
	etag?: unknown;
	ttl?: unknown;
	password?: unknown;
	parts?: unknown;
}

interface CompleteResponse {
	shareToken: string;
	shareUrl: string;
	fullUrl: string;
	expiresAt: number;
}

/** Best-effort delete of an S3 object (idempotent on 404). */
async function safeDeleteS3Object(
	client: ReturnType<typeof createS3Client>,
	bucket: string,
	key: string
): Promise<void> {
	try {
		await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
	} catch (err) {
		console.error('[complete] rollback S3 delete failed', {
			key,
			err: err instanceof Error ? err.message : String(err)
		});
	}
}

/**
 * POST /api/upload/complete
 *
 * Finalizes an upload — supports two modes detected from body fields:
 *
 *   single (default):
 *     { uploadId, key, filename, size, contentType, etag, ttl, password? }
 *
 *   multipart:
 *     { mode:"multipart", uploadId, s3UploadId, key, filename, size,
 *       contentType, parts:[{partNumber,etag}], ttl, password? }
 */
export const POST: RequestHandler = async ({
	request,
	platform,
	getClientAddress,
	url
}) => {
	const env = platform!.env;
	const ip = getClientIp(request, getClientAddress());
	const userAgent = request.headers.get('user-agent')?.slice(0, 200) ?? null;

	try {
		return await handleComplete(
			request,
			{ env, ip, userAgent },
			url.origin
		);
	} catch (err) {
		console.error('[complete] unhandled error', {
			err: err instanceof Error ? err.message : String(err),
			stack: err instanceof Error ? err.stack : undefined
		});
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};

async function handleComplete(
	request: Request,
	ctx: {
		env: CloudflareEnv;
		ip: string;
		userAgent: string | null;
	},
	origin: string
): Promise<Response> {
	const { env, ip, userAgent } = ctx;

	// Admin bypass: JWT cookie skips rate limiting and per-IP daily quota.
	const isAdmin = await requestIsAuthorized(env, request);

	// ── Rate limit — skipped for admin ──
	if (!isAdmin) {
		const rl = await checkRateLimit(env, 'UPLOAD_COMPLETE_LIMIT', ip);
		if (!rl.success) {
			await audit(env, {
				ip,
				action: 'complete',
				status: 429,
				detail: { reason: 'rate-limit' }
			});
			return json({ error: 'Too Many Requests' }, { status: 429 });
		}
	}

	// ── Parse body ──
	let body: CompleteBody;
	try {
		body = (await request.json()) as CompleteBody;
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const uploadId = typeof body.uploadId === 'string' ? body.uploadId.trim() : '';
	const key = typeof body.key === 'string' ? body.key.trim() : '';
	const filename =
		typeof body.filename === 'string' ? body.filename.trim() : '';
	const contentType =
		typeof body.contentType === 'string' ? body.contentType.trim() : '';
	const size = typeof body.size === 'number' ? body.size : -1;

	if (!uploadId || !key || !filename || !contentType || size < 1) {
		return json(
			{
				error:
					'uploadId, key, filename, contentType, and positive size are all required'
			},
			{ status: 400 }
		);
	}

	// Detect mode
	const isMultipart = body.mode === 'multipart' || Array.isArray(body.parts);

	// ── TTL ──
	const minTtl = Number(env.MIN_SHARE_TTL);
	const maxTtl = Number(env.MAX_SHARE_TTL);
	let ttl = maxTtl;
	if (body.ttl !== undefined && body.ttl !== null) {
		const requested = Number(body.ttl);
		if (!Number.isFinite(requested)) {
			return json({ error: 'ttl must be a number' }, { status: 400 });
		}
		// Admin can send ttl=0 for "no expiry".
		if (requested === 0 && isAdmin) {
			ttl = 0;
		} else if (requested < minTtl || requested > maxTtl) {
			return json(
				{ error: `ttl must be in [${minTtl}, ${maxTtl}] seconds` },
				{ status: 400 }
			);
		} else {
			ttl = requested;
		}
	}

	// ── Password ──
	let passwordHash: string | undefined;
	let passwordSalt: string | undefined;
	if (
		body.password !== undefined &&
		body.password !== null &&
		body.password !== ''
	) {
		if (!isValidPassword(body.password)) {
			return json(
				{ error: 'password must be 1-256 characters' },
				{ status: 400 }
			);
		}
		const hashed = await hashPassword(body.password as string);
		passwordHash = hashed.hash;
		passwordSalt = hashed.salt;
	}

	// ── Per-IP daily quota pre-check — skipped for admin ──
	let dayKey = '';
	let maxBytes = 0;
	let maxCount = 0;
	if (!isAdmin) {
		dayKey = utcDayKey();
		maxBytes = Number(env.MAX_DAILY_BYTES_PER_IP);
		maxCount = Number(env.MAX_DAILY_COUNT_PER_IP);

		const quota = await readQuota(env, ip, dayKey);
		if (quota) {
			if (quota.totalBytes + size > maxBytes) {
				await audit(env, {
					ip,
					action: 'complete',
					status: 429,
					detail: { reason: 'quota-bytes', quota }
				});
				return json(
					{
						error: `Daily upload limit exceeded (max ${maxBytes} bytes per IP)`
					},
					{ status: 429 }
				);
			}
			if (quota.count + 1 > maxCount) {
				await audit(env, {
					ip,
					action: 'complete',
					status: 429,
					detail: { reason: 'quota-count', quota }
				});
				return json(
					{ error: `Daily file count exceeded (max ${maxCount} files per IP)` },
					{ status: 429 }
				);
			}
		}
	} else {
		dayKey = utcDayKey();
	}

	const client = createS3Client(env);

	// ──────────────────────────────────────────────────────────────────
	//  MULTIPART: complete the S3 multipart upload
	// ──────────────────────────────────────────────────────────────────
	if (isMultipart) {
		const s3UploadId =
			typeof body.s3UploadId === 'string' ? body.s3UploadId.trim() : '';
		const rawParts = body.parts;

		if (!s3UploadId || !Array.isArray(rawParts) || rawParts.length === 0) {
			return json(
				{
					error:
						'multipart mode requires s3UploadId and non-empty parts array'
				},
				{ status: 400 }
			);
		}

		const parts: CompletedPart[] = [];
		for (const p of rawParts) {
			if (
				typeof p !== 'object' ||
				p === null ||
				typeof (p as Record<string, unknown>).partNumber !== 'number' ||
				typeof (p as Record<string, unknown>).etag !== 'string'
			) {
				return json(
					{
						error: 'each part must have partNumber (number) and etag (string)'
					},
					{ status: 400 }
				);
			}
			parts.push({
				partNumber: (p as Record<string, unknown>).partNumber as number,
				etag: ((p as Record<string, unknown>).etag as string).replace(/"/g, '')
			});
		}

		try {
			await completeMultipartUpload({
				client,
				bucket: bucketName(env),
				key,
				uploadId: s3UploadId,
				parts
			});
		} catch (err) {
			await audit(env, {
				ip,
				action: 'complete',
				status: 500,
				detail: {
					reason: 'multipart-complete-failed',
					key,
					s3UploadId,
					error: err instanceof Error ? err.message : String(err)
				}
			});
			try {
				await abortMultipartUpload({
					client,
					bucket: bucketName(env),
					key,
					uploadId: s3UploadId
				});
			} catch (abortErr) {
				console.error('[complete] rollback abort failed', {
					key,
					s3UploadId,
					err:
						abortErr instanceof Error
							? abortErr.message
							: String(abortErr)
				});
			}
			return json(
				{ error: 'Failed to finalize multipart upload on S3' },
				{ status: 500 }
			);
		}

		// ── Mint token ──
		const expiresAt =
			ttl === 0
				? Date.now() + 100 * 365 * 86400 * 1000
				: Date.now() + ttl * 1000;
		let token: string;
		try {
			const r = await createShare(env, {
				bucket: env.S3_BUCKET,
				s3Key: key,
				filename,
				sizeBytes: size,
				contentType,
				expiresAt,
				ip,
				userAgent,
				passwordHash,
				passwordSalt
			});
			token = r.token;
		} catch (err) {
			await audit(env, {
				ip,
				action: 'complete',
				status: 500,
				detail: {
					reason: 'create-share-failed',
					key,
					error: err instanceof Error ? err.message : String(err)
				}
			});
			await safeDeleteS3Object(client, bucketName(env), key);
			return json({ error: 'Failed to mint share token' }, { status: 500 });
		}

		// ── Increment quota (atomic; rolls back S3 if it breaches) ──
		if (!isAdmin) {
			const q = await incrementQuota(env, {
				ip,
				day: dayKey,
				bytes: size,
				maxBytes,
				maxCount
			});
			if (!q.ok) {
				console.warn('[complete] quota raced, rolling back', {
					ip,
					day: dayKey,
					reason: q.reason,
					totalBytes: q.totalBytes,
					count: q.count
				});
				await audit(env, {
					ip,
					action: 'complete',
					status: 429,
					detail: {
						reason: `quota-${q.reason}-raced`,
						quota: { totalBytes: q.totalBytes, count: q.count }
					}
				});
				try {
					await env.DB.prepare(`DELETE FROM shares WHERE token = ?1`)
						.bind(token)
						.run();
				} catch (delErr) {
					console.error('[complete] rollback D1 delete failed', {
						token,
						err: delErr instanceof Error ? delErr.message : String(delErr)
					});
				}
				await safeDeleteS3Object(client, bucketName(env), key);
				return json(
					{
						error: `Daily upload limit exceeded (max ${maxBytes} bytes per IP)`
					},
					{ status: 429 }
				);
			}
		}

		await audit(env, {
			ip,
			action: 'complete',
			shareToken: token,
			status: 200,
			detail: {
				key,
				size,
				expiresAt,
				mode: 'multipart',
				parts: parts.length,
				via: isAdmin ? 'admin' : 'anon'
			}
		});

		const response: CompleteResponse = {
			shareToken: token,
			shareUrl: `/d/${token}`,
			fullUrl: `${origin}/d/${token}`,
			expiresAt
		};
		return json(response);
	}

	// ──────────────────────────────────────────────────────────────────
	//  SINGLE: original flow with etag-based verification
	// ──────────────────────────────────────────────────────────────────
	const etag = typeof body.etag === 'string' ? body.etag.trim() : '';
	if (!etag) {
		return json(
			{ error: 'etag is required for single PUT uploads' },
			{ status: 400 }
		);
	}

	// Verify the object actually exists in S3 before minting a share token.
	// MinIO via Cloudflare WAF sometimes blocks HeadObject from Workers (err
	// 1010), so on failure we trust the client's presigned-PUT success and
	// audit-log the skip rather than failing the upload entirely.
	let verified = false;
	let headError: string | null = null;
	try {
		const head = await client.send(
			new HeadObjectCommand({ Bucket: bucketName(env), Key: key })
		);
		if (
			head &&
			typeof head.ContentLength === 'number' &&
			head.ContentLength > 0
		) {
			const objSize = head.ContentLength;
			const objEtag =
				typeof head.ETag === 'string' ? head.ETag.replace(/"/g, '') : '';
			if (objSize === size && objEtag === etag) {
				verified = true;
			}
		}
	} catch (err) {
		headError = err instanceof Error ? err.message : String(err);
		console.warn('[complete] HeadObject failed, trusting client PUT', {
			key,
			size,
			etag,
			err: headError
		});
	}

	if (!verified) {
		await audit(env, {
			ip,
			action: 'complete',
			status: 200,
			detail: {
				reason: 'verify-skipped',
				key,
				size,
				etag,
				s3Error:
					headError ??
					'HeadObject did not match client-reported size/etag; trusting client-reported PUT success'
			}
		});
	}

	// ── Mint token ──
	const expiresAt =
		ttl === 0 ? Date.now() + 100 * 365 * 86400 * 1000 : Date.now() + ttl * 1000;
	let token: string;
	try {
		const r = await createShare(env, {
			bucket: env.S3_BUCKET,
			s3Key: key,
			filename,
			sizeBytes: size,
			contentType,
			expiresAt,
			ip,
			userAgent,
			passwordHash,
			passwordSalt
		});
		token = r.token;
	} catch (err) {
		await audit(env, {
			ip,
			action: 'complete',
			status: 500,
			detail: {
				reason: 'create-share-failed',
				key,
				error: err instanceof Error ? err.message : String(err)
			}
		});
		await safeDeleteS3Object(client, bucketName(env), key);
		return json({ error: 'Failed to mint share token' }, { status: 500 });
	}

	// ── Increment quota (atomic; rolls back S3 if it breaches) ──
	if (!isAdmin) {
		const q = await incrementQuota(env, {
			ip,
			day: dayKey,
			bytes: size,
			maxBytes,
			maxCount
		});
		if (!q.ok) {
			console.warn('[complete] quota raced, rolling back', {
				ip,
				day: dayKey,
				reason: q.reason,
				totalBytes: q.totalBytes,
				count: q.count
			});
			await audit(env, {
				ip,
				action: 'complete',
				status: 429,
				detail: {
					reason: `quota-${q.reason}-raced`,
					quota: { totalBytes: q.totalBytes, count: q.count }
				}
			});
			try {
				await env.DB.prepare(`DELETE FROM shares WHERE token = ?1`)
					.bind(token)
					.run();
			} catch (delErr) {
				console.error('[complete] rollback D1 delete failed', {
					token,
					err: delErr instanceof Error ? delErr.message : String(delErr)
				});
			}
			await safeDeleteS3Object(client, bucketName(env), key);
			return json(
				{ error: `Daily upload limit exceeded (max ${maxBytes} bytes per IP)` },
				{ status: 429 }
			);
		}
	}

	await audit(env, {
		ip,
		action: 'complete',
		shareToken: token,
		status: 200,
		detail: {
			key,
			size,
			expiresAt,
			mode: 'single',
			via: isAdmin ? 'admin' : 'anon'
		}
	});

	const response: CompleteResponse = {
		shareToken: token,
		shareUrl: `/d/${token}`,
		fullUrl: `${origin}/d/${token}`,
		expiresAt
	};
	return json(response);
}