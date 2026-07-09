import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
const c = new S3Client({
  region: "auto",
  endpoint: "https://s3api.022025.xyz",
  forcePathStyle: true,
  credentials: { accessKeyId: "krsz", secretAccessKey: "cxk114514" },
});
const fs = await import("node:fs/promises");
const body = await fs.readFile("/tmp/cleanup-test.bin");
const key = "uploads/2026/07/09/tmp-test12345/cleanup-test.bin";
await c.send(new PutObjectCommand({ Bucket: "cf-share", Key: key, Body: body, ContentType: "application/octet-stream" }));
const h = await c.send(new HeadObjectCommand({ Bucket: "cf-share", Key: key }));
console.log("OK head:", h.ETag, "size:", h.ContentLength);
