import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { S3Client } from "@aws-sdk/client-s3";

/**
 * Generate a presigned PUT URL the browser can use to upload directly to S3.
 *
 * The URL is short-lived (`expiresIn` seconds, default 600). The `Content-Type`
 * header is bound to the URL so the browser must send exactly that value when
 * PUTting; S3 will reject mismatches (depending on bucket policy).
 */
export async function presignPut(args: {
  client: S3Client;
  bucket: string;
  key: string;
  contentType: string;
  expiresIn: number;
}): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: args.bucket,
    Key: args.key,
    ContentType: args.contentType,
  });
  return getSignedUrl(args.client, cmd, { expiresIn: args.expiresIn });
}

/**
 * Generate a presigned GET URL the browser uses to download the file.
 *
 * Pass `responseContentDisposition` to force "Save as" with a specific filename,
 * or `responseContentType` to override the S3-stored Content-Type.
 */
export async function presignGet(args: {
  client: S3Client;
  bucket: string;
  key: string;
  expiresIn: number;
  filename?: string;
  contentType?: string;
}): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: args.bucket,
    Key: args.key,
    ...(args.filename
      ? {
          ResponseContentDisposition: `attachment; filename="${args.filename.replace(/"/g, "")}"`,
        }
      : {}),
    ...(args.contentType ? { ResponseContentType: args.contentType } : {}),
  });
  return getSignedUrl(args.client, cmd, { expiresIn: args.expiresIn });
}
