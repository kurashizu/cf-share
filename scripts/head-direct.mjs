import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
const c = new S3Client({
  region: "auto",
  endpoint: "https://s3api.022025.xyz",
  forcePathStyle: true,
  credentials: { accessKeyId: "krsz", secretAccessKey: "cxk114514" },
});
const key = "uploads/2026/07/09/tmp-d9646989/e2e4.bin";
console.log("HEADing", key);
try {
  const h = await c.send(new HeadObjectCommand({ Bucket: "cf-share", Key: key }));
  console.log("FOUND:", { ETag: h.ETag, Size: h.ContentLength });
} catch (e) {
  console.log("MISSING:", e.$metadata?.httpStatusCode, e.name, e.message);
}
