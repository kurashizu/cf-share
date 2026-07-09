import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
const c = new S3Client({
  region: "auto",
  endpoint: "https://s3api.022025.xyz",
  forcePathStyle: true,
  credentials: { accessKeyId: "krsz", secretAccessKey: "cxk114514" },
});
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
  const h = await c.send(new HeadObjectCommand({ Bucket: "cf-share", Key: "uploads/2026/07/09/tmp-d9646989/e2e4.bin" }));
  console.log("OK:", h.ContentLength);
} catch (e) {
  console.log("ERR:", e.name, e.message, e.$metadata?.httpStatusCode);
}
