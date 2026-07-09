/// <reference path="../../cloudflare-env.d.ts" />

/**
 * Wrap Cloudflare's built-in Rate Limiting binding.
 *
 * Usage:
 *   const { success } = await checkRateLimit(env, "UPLOAD_INIT_LIMIT", ip);
 *   if (!success) return new Response("Too Many Requests", { status: 429 });
 *
 * If the binding is missing (e.g. local dev without wrangler), the check is
 * a no-op success — never block development.
 *
 * `CloudflareEnv` is a globally-augmented interface (see cloudflare-env.d.ts);
 * we don't import it directly to keep this file module-friendly.
 */
export async function checkRateLimit(
  env: CloudflareEnv,
  binding: keyof Pick<
    CloudflareEnv,
    | "UPLOAD_INIT_LIMIT"
    | "UPLOAD_COMPLETE_LIMIT"
    | "DOWNLOAD_LIMIT"
    | "DOWNLOAD_LOOKUP_LIMIT"
    | "GLOBAL_IP_DAILY"
  >,
  key: string,
): Promise<{ success: boolean }> {
  const limiter = env[binding] as
    | { limit: (options: { key: string }) => Promise<{ success: boolean }> }
    | undefined;
  if (!limiter) {
    return { success: true };
  }
  try {
    return await limiter.limit({ key });
  } catch {
    // Fail open on unexpected errors to avoid taking the app down.
    return { success: true };
  }
}
