/// <reference path="../../cloudflare-env.d.ts" />

/**
 * Append a row to audit_log. Failures are swallowed (audit must never break
 * the request path).
 */
export async function audit(
  env: CloudflareEnv,
  entry: {
    ip: string;
    action:
      "init" | "complete" | "download" | "expire" | "delete" | "admin_view";
    shareToken?: string | null;
    status: number;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO audit_log (ts, ip, action, share_token, status, detail_json)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
      .bind(
        Date.now(),
        entry.ip,
        entry.action,
        entry.shareToken ?? null,
        entry.status,
        entry.detail ? JSON.stringify(entry.detail) : null,
      )
      .run();
  } catch {
    // ignore
  }
}
