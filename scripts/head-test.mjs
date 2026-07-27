import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { createS3Client, getBucket } from "./_s3-client.mjs";

const c = createS3Client();
const bucket = getBucket();
try {
  const h = await c.send(new HeadObjectCommand({ Bucket: bucket, Key: "uploads/2026/07/09/tmp-test12345/cleanup-test.bin" }));
  console.log("STILL EXISTS:", h.ETag);
} catch (e) {
  console.log("DELETED (as expected):", e.$metadata?.httpStatusCode, e.name);
}