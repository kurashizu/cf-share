import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createS3Client, getBucket } from "./_s3-client.mjs";

const c = createS3Client();
const bucket = getBucket();
const key = "uploads/2026/07/09/tmp-d9646989/e2e4.bin";
const url = await getSignedUrl(c, new HeadObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 60 });
console.log(url);