/// <reference path="../../cloudflare-env.d.ts" />

/**
 * Global storage-pool capacity check (MAX_TOTAL_BYTES / MAX_TOTAL_COUNT
 * across all active shares). Shared by upload init AND complete so the pool
 * limit cannot be bypassed by calling complete directly.
 */

export type PoolCheck =
  | { ok: true }
  | {
      ok: false;
      reason: "total-pool-exceeded" | "total-count-exceeded";
      currentTotal: number;
      currentCount: number;
      maxTotalBytes: number;
      maxTotalCount: number;
    };

export async function checkPoolCapacity(
  env: CloudflareEnv,
  requestedBytes: number,
): Promise<PoolCheck> {
  const maxTotalBytes = Number(env.MAX_TOTAL_BYTES);
  const maxTotalCount = Number(env.MAX_TOTAL_COUNT ?? 0);
  if (maxTotalBytes <= 0 && maxTotalCount <= 0) return { ok: true };

  let totalRow: { total: number; cnt: number } | null = null;
  try {
    totalRow = await env.DB.prepare(
      `SELECT COALESCE(SUM(size_bytes), 0) AS total, COUNT(*) AS cnt
			 FROM shares WHERE expires_at = 0 OR expires_at > ?1`,
    )
      .bind(Date.now())
      .first<{ total: number; cnt: number }>();
  } catch {
    // DB unavailable — don't take uploads down over the pool check.
    return { ok: true };
  }

  const currentTotal = totalRow?.total ?? 0;
  const currentCount = totalRow?.cnt ?? 0;

  if (maxTotalBytes > 0 && currentTotal + requestedBytes > maxTotalBytes) {
    return {
      ok: false,
      reason: "total-pool-exceeded",
      currentTotal,
      currentCount,
      maxTotalBytes,
      maxTotalCount,
    };
  }
  if (maxTotalCount > 0 && currentCount >= maxTotalCount) {
    return {
      ok: false,
      reason: "total-count-exceeded",
      currentTotal,
      currentCount,
      maxTotalBytes,
      maxTotalCount,
    };
  }
  return { ok: true };
}
