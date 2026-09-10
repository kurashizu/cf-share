/// <reference path="../../cloudflare-env.d.ts" />

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { createS3Client } from "./client";

/**
 * Server-side direct write — the Worker already holds the bytes in memory
 * (e.g. a WebSocket message payload) so there's no client to hand a
 * presigned PUT URL to, unlike the share upload flow.
 */
export async function putS3Object(
  env: CloudflareEnv,
  bucket: string,
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  const client = createS3Client(env);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}
