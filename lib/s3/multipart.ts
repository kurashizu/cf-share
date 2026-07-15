import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
  ListPartsCommandOutput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { S3Client } from "@aws-sdk/client-s3";

export const MULTIPART_THRESHOLD = 90 * 1024 * 1024; // 90 MB — switch to multipart above this
export const MULTIPART_PART_SIZE = 50 * 1024 * 1024; // 50 MB per part

export interface PartPresign {
  partNumber: number;
  url: string;
  size: number; // bytes for this part
}

/**
 * Initiate a multipart upload on S3 and return presigned URLs for every part.
 */
export async function initiateMultipartUpload(args: {
  client: S3Client;
  bucket: string;
  key: string;
  fileSize: number;
  partSize?: number;
  expiresIn?: number;
}): Promise<{ uploadId: string; parts: PartPresign[] }> {
  const partSize = args.partSize ?? MULTIPART_PART_SIZE;
  const expiresIn = args.expiresIn ?? 600;

  // Start the multipart session
  const createResp = await args.client.send(
    new CreateMultipartUploadCommand({
      Bucket: args.bucket,
      Key: args.key,
    }),
  );
  const uploadId = createResp.UploadId!;

  // Calculate parts
  const totalParts = Math.ceil(args.fileSize / partSize);
  const parts: PartPresign[] = [];

  for (let i = 0; i < totalParts; i++) {
    const partNumber = i + 1;
    const isLast = i === totalParts - 1;
    const size = isLast
      ? args.fileSize - i * partSize
      : partSize;

    const url = await getSignedUrl(
      args.client,
      new UploadPartCommand({
        Bucket: args.bucket,
        Key: args.key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn },
    );

    parts.push({ partNumber, url, size });
  }

  return { uploadId, parts };
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

/**
 * Finalise a multipart upload on S3.
 */
export async function completeMultipartUpload(args: {
  client: S3Client;
  bucket: string;
  key: string;
  uploadId: string;
  parts: CompletedPart[];
}): Promise<void> {
  await args.client.send(
    new CompleteMultipartUploadCommand({
      Bucket: args.bucket,
      Key: args.key,
      UploadId: args.uploadId,
      MultipartUpload: {
        Parts: args.parts.map((p) => ({
          PartNumber: p.partNumber,
          ETag: p.etag,
        })),
      },
    }),
  );
}

/**
 * Abort a multipart upload (cleanup on cancel / failure).
 */
export async function abortMultipartUpload(args: {
  client: S3Client;
  bucket: string;
  key: string;
  uploadId: string;
}): Promise<void> {
  await args.client.send(
    new AbortMultipartUploadCommand({
      Bucket: args.bucket,
      Key: args.key,
      UploadId: args.uploadId,
    }),
  );
}

/** Determine whether multipart should be used for a given file size. */
export function shouldUseMultipart(fileSize: number): boolean {
  return fileSize > MULTIPART_THRESHOLD;
}

/**
 * A part that the client successfully PUT to S3, as returned by ListParts.
 * We only need partNumber + ETag to later call CompleteMultipartUpload.
 */
export interface UploadedPart {
  partNumber: number;
  etag: string;
}

/**
 * Compute the set of part numbers still missing given what the client
 * already knows it uploaded, plus the total parts the upload should have.
 *
 * NOTE: We deliberately do NOT call `ListParts` from the server here. The
 * S3 endpoint behind Cloudflare WAF (1010) blocks the AWS SDK's ListParts
 * request signature (verified via raw curl from outside the Worker),
 * causing the call to hang and the Worker to be canceled by the runtime.
 * Other S3 commands (ListMultipartUploads, CreateMultipartUpload, etc.) work
 * fine from the Worker, so the issue is specific to ListParts.
 *
 * Instead, the client tracks uploaded parts in localStorage (see
 * `components/uploader/lib/resume.ts`) and sends them back when resuming.
 * If localStorage is wiped, the user simply starts a fresh upload — the
 * abandoned multipart session will be aborted by the cleanup cron within
 * 90 minutes.
 */
export function computeMissingParts(
  totalSize: number,
  uploadedPartNumbers: Set<number>,
): number[] {
  const partSize = MULTIPART_PART_SIZE;
  const totalParts = Math.ceil(totalSize / partSize);
  const out: number[] = [];
  for (let i = 1; i <= totalParts; i++) {
    if (!uploadedPartNumbers.has(i)) out.push(i);
  }
  return out;
}

/**
 * Re-sign presigned PUT URLs for a specific set of part numbers. Used by
 * the resume endpoint when a part's URL has expired or the client wants
 * to re-upload a failed part without re-signing everything.
 *
 * Caller is responsible for deciding which partNumbers need re-signing.
 */
export async function presignParts(args: {
  client: S3Client;
  bucket: string;
  key: string;
  uploadId: string;
  partNumbers: number[];
  expiresIn: number;
}): Promise<PartPresign[]> {
  const out: PartPresign[] = [];
  for (const partNumber of args.partNumbers) {
    const url = await getSignedUrl(
      args.client,
      new UploadPartCommand({
        Bucket: args.bucket,
        Key: args.key,
        UploadId: args.uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: args.expiresIn },
    );
    out.push({ partNumber, url, size: 0 });
  }
  return out;
}
