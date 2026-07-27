import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { createS3Client, getBucket } from "./_s3-client.mjs";

const c = createS3Client();
const bucket = getBucket();
c.middlewareStack.add(
  (next, context) => async (args) => {
    console.log("[REQ]", args.request?.method, args.request?.path);
    console.log("[REQ] auth:", args.request?.headers?.authorization?.slice(0, 80) + "...");
    const r = await next(args);
    console.log("[RESP] Status:", r.response?.statusCode);
    return r;
  },
  { step: "finalizeRequest", name: "debugLogger", priority: "low" }
);
try {
  const h = await c.send(new HeadObjectCommand({ Bucket: bucket, Key: "uploads/2026/07/09/tmp-d9646989/e2e4.bin" }));
  console.log("OK:", h.ContentLength);
} catch (e) {
  console.log("ERR:", e.name, e.message, e.$metadata?.httpStatusCode);
}