import { ListMultipartUploadsCommand, ListObjectsV2Command, HeadBucketCommand } from "@aws-sdk/client-s3";
import { createS3Client, getBucket } from "./_s3-client.mjs";

const client = createS3Client();
const bucket = getBucket();

console.log("Test 1: HeadBucket");
try {
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
  console.log("  OK");
} catch (e) {
  console.log("  FAIL:", e.name, e.$metadata?.httpStatusCode, e.message?.slice(0, 120));
}

console.log("Test 2: ListObjectsV2");
try {
  const r = await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 3 }));
  console.log("  OK, objects:", r.Contents?.length ?? 0);
} catch (e) {
  console.log("  FAIL:", e.name, e.$metadata?.httpStatusCode, e.message?.slice(0, 120));
}

console.log("Test 3: ListMultipartUploads");
try {
  const r = await client.send(new ListMultipartUploadsCommand({ Bucket: bucket, MaxUploads: 5 }));
  console.log("  OK, uploads:", r.Uploads?.length ?? 0);
} catch (e) {
  console.log("  FAIL:", e.name, e.$metadata?.httpStatusCode, e.message?.slice(0, 120));
}

console.log("Done");
process.exit(0);