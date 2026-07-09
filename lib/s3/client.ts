import { S3Client } from "@aws-sdk/client-s3";

/**
 * Build an S3 client from Worker env bindings.
 *
 * Verified against https://s3api.022025.xyz: path-style URLs work,
 * bucket `cf-share` is reachable, HeadBucket / PutObject / GetObject /
 * DeleteObject all succeed with the access key configured in
 * `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`.
 */
export function createS3Client(env: {
  S3_ENDPOINT: string;
  S3_REGION: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
}): S3Client {
  return new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: true, // verified for s3api.022025.xyz
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    // Disable SDK v3.1071+ FlexChecksums: the MinIO-based S3 server at
    // s3api.022025.xyz returns 403 on HEAD / DeleteObject when the SDK
    // sends trailing checksum headers it doesn't understand.
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
}

export function bucketName(env: { S3_BUCKET: string }): string {
  return env.S3_BUCKET;
}
