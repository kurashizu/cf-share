import { PutObjectCommand, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createS3Client, getBucket } from "./_s3-client.mjs";

const c = createS3Client();
const bucket = getBucket();
const key = "test-diagnostic-" + Date.now() + ".txt";

// PUT
await c.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: "hello", ContentType: "text/plain" }));
console.log("PUT OK");

// HEAD via SDK
try {
  const h = await c.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  console.log("HEAD via SDK OK:", h.ContentLength);
} catch (e) {
  console.log("HEAD via SDK FAIL:", e.$metadata?.httpStatusCode, e.name, e.message);
}

// HEAD via signed URL
const headUrl = await getSignedUrl(c, new HeadObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 60 });
const r = await fetch(headUrl, { method: "HEAD" });
console.log("HEAD via signed URL:", r.status, r.headers.get("content-length"));

// GET (just to confirm it's there)
try {
  const g = await c.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  console.log("GET via SDK OK:", (await g.Body.transformToByteArray()).length);
} catch (e) {
  console.log("GET via SDK FAIL:", e.$metadata?.httpStatusCode, e.name);
}