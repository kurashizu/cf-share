import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
const c = new S3Client({
  region: "auto",
  endpoint: "https://s3api.022025.xyz",
  forcePathStyle: true,
  credentials: { accessKeyId: "krsz", secretAccessKey: "cxk114514" },
});
const key = "uploads/2026/07/09/tmp-d9646989/e2e4.bin";
const url = await getSignedUrl(c, new HeadObjectCommand({ Bucket: "cf-share", Key: key }), { expiresIn: 60 });
console.log(url);
