import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
const c = new S3Client({
  region: "auto",
  endpoint: "https://s3api.022025.xyz",
  forcePathStyle: true,
  credentials: { accessKeyId: "krsz", secretAccessKey: "cxk114514" },
});
try {
  const h = await c.send(new HeadObjectCommand({ Bucket: "cf-share", Key: "uploads/2026/07/09/tmp-test12345/cleanup-test.bin" }));
  console.log("STILL EXISTS:", h.ETag);
} catch (e) {
  console.log("DELETED (as expected):", e.$metadata?.httpStatusCode, e.name);
}
