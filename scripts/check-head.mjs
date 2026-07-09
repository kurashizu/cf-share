import { S3Client, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
const c = new S3Client({
  region: "auto",
  endpoint: "https://s3api.022025.xyz",
  forcePathStyle: true,
  credentials: { accessKeyId: "krsz", secretAccessKey: "cxk114514" },
});

// Check what's actually in the bucket under the path
const key = "uploads/2026/07/09/tmp-a6e61eb9/e2e-test.bin";
try {
  const h = await c.send(new HeadObjectCommand({ Bucket: "cf-share", Key: key }));
  console.log("FOUND:", { ETag: h.ETag, Size: h.ContentLength, LastModified: h.LastModified });
} catch (e) {
  console.log("MISSING:", e.$metadata?.httpStatusCode, e.name);
}

// Verify the PUT actually worked by looking at the response we got
console.log("---");
// Now do a fresh PUT and HEAD with the same client to see
const fs = await import("node:fs/promises");
const body = Buffer.from("test-marker-content-for-debug");
const putResult = await c.send(new PutObjectCommand({ Bucket: "cf-share", Key: "debug-marker.txt", Body: body, ContentType: "text/plain" }));
console.log("PUT ETag from SDK:", putResult.ETag);
try {
  const h2 = await c.send(new HeadObjectCommand({ Bucket: "cf-share", Key: "debug-marker.txt" }));
  console.log("HEAD from SDK:", { ETag: h2.ETag, Size: h2.ContentLength });
} catch (e) {
  console.log("HEAD MISSING:", e.$metadata?.httpStatusCode);
}
