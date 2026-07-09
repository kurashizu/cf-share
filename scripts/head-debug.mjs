import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
const c = new S3Client({
  region: "auto",
  endpoint: "https://s3api.022025.xyz",
  forcePathStyle: true,
  credentials: { accessKeyId: "krsz", secretAccessKey: "cxk114514" },
});
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
  await c.send(new HeadObjectCommand({ Bucket: "cf-share", Key: "test-diagnostic-1763255700000.txt" }));
} catch (e) {
  console.log("ERR:", e.name, e.message);
}
