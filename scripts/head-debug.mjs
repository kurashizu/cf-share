import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { createS3Client, getBucket } from "./_s3-client.mjs";

const c = createS3Client();
const bucket = getBucket();
c.middlewareStack.add(
  (next, context) => async (args) => {
    console.log("[REQ]", args.request?.method, args.request?.path || args.input?.Key);
    console.log("[REQ] Headers:", JSON.stringify(args.request?.headers, null, 2));
    const r = await next(args);
    console.log("[RESP] Status:", r.response?.statusCode);
    return r;
  },
  { step: "finalizeRequest", name: "debugLogger", priority: "low" }
);
try {
  await c.send(new HeadObjectCommand({ Bucket: bucket, Key: "test-diagnostic-1763255700000.txt" }));
} catch (e) {
  console.log("ERR:", e.name, e.message);
}