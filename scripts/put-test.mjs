import { PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { createS3Client, getBucket } from "./_s3-client.mjs";

const c = createS3Client();
const bucket = getBucket();
const fs = await import("node:fs/promises");
const body = await fs.readFile("/tmp/cleanup-test.bin");
const key = "uploads/2026/07/09/tmp-test12345/cleanup-test.bin";
await c.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: "application/octet-stream" }));
const h = await c.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
console.log("OK head:", h.ETag, "size:", h.ContentLength);