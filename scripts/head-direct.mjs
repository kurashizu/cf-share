import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { createS3Client, getBucket } from "./_s3-client.mjs";

const c = createS3Client();
const bucket = getBucket();
const key = "uploads/2026/07/09/tmp-d9646989/e2e4.bin";
console.log("HEADing", key);
try {
  const h = await c.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  console.log("FOUND:", { ETag: h.ETag, Size: h.ContentLength });
} catch (e) {
  console.log("MISSING:", e.$metadata?.httpStatusCode, e.name, e.message);
}