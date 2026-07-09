import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
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
