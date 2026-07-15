"use client";

import { useCallback, useEffect, useState } from "react";
import { Uploader } from "../../components/uploader/Uploader";

/* ================================================================== */
/*  Types                                                             */
/* ================================================================== */

interface ShareRow {
  token: string;
  bucket: string;
  s3_key: string;
  filename: string;
  size_bytes: number;
  content_type: string;
  expires_at: number;
  created_at: number;
  created_ip: string | null;
  user_agent: string | null;
  download_count: number;
  last_download_at: number | null;
}

interface AuditRow {
  id: number;
  ts: number;
  ip: string | null;
  action: string;
  share_token: string | null;
  status: number | null;
  detail_json: string | null;
}

interface SharesData {
  shares: ShareRow[];
  stats: {
    total: number;
    active: number;
    expired: number;
    totalBytes: number;
    activeBytes: number;
  };
  page: number;
  totalPages: number;
  totalShares: number;
}

interface AuditData {
  entries: AuditRow[];
  actions: string[];
  stats: {
    total: number;
    uniqueIps: number;
    lastTs: number | null;
  };
  page: number;
  totalPages: number;
  totalEntries: number;
}

type TabId = "shares" | "audit" | "upload";

/* ================================================================== */
/*  Helpers                                                           */
/* ================================================================== */

function fmtSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + " " + units[i];
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

function fmtDuration(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function isExpired(ts: number): boolean {
  return ts < Date.now();
}

/* ================================================================== */
/*  Page                                                              */
/* ================================================================== */

export default function AdminPage() {
  const [tab, setTab] = useState<TabId>("shares");

  // Share tab state
  const [sharesData, setSharesData] = useState<SharesData | null>(null);
  const [sharePage, setSharePage] = useState(1);
  const [shareQuery, setShareQuery] = useState("");
  const [shareShowAll, setShareShowAll] = useState(false);
  const [sharesLoading, setSharesLoading] = useState(true);

  // Audit tab state
  const [auditData, setAuditData] = useState<AuditData | null>(null);
  const [auditPage, setAuditPage] = useState(1);
  const [auditQuery, setAuditQuery] = useState("");
  const [auditAction, setAuditAction] = useState("");
  const [auditLoading, setAuditLoading] = useState(true);

  // Delete state
  const [deleteToken, setDeleteToken] = useState<string | null>(null);

  // Auth state
  const [authChecked, setAuthChecked] = useState(false);

  // ── Auth check on mount ─────────────────────────────────────────
  useEffect(() => {
    fetch("/api/admin/shares?page=1")
      .then((r) => {
        if (r.status === 401) {
          window.location.href = "/api/admin/challenge?redirect=/admin";
          return;
        }
        if (!r.ok) throw new Error(`Auth check failed: ${r.status}`);
        setAuthChecked(true);
      })
      .catch((err) => {
        console.error("Auth check error:", err);
        setAuthChecked(true);
      });
  }, []);

  // ── Fetch shares ────────────────────────────────────────────────
  const loadShares = useCallback(
    async (page: number, q: string, all: boolean) => {
      setSharesLoading(true);
      try {
        const params = new URLSearchParams({ page: String(page) });
        if (q) params.set("q", q);
        if (all) params.set("all", "1");

        const res = await fetch(`/api/admin/shares?${params}`);
        if (res.status === 401) {
          window.location.href = "/api/admin/challenge?redirect=/admin";
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data: SharesData = await res.json();
        setSharesData(data);
      } catch (err) {
        console.error("Failed to load shares:", err);
      } finally {
        setSharesLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!authChecked) return;
    loadShares(sharePage, shareQuery, shareShowAll);
  }, [authChecked, sharePage, shareQuery, shareShowAll, loadShares]);

  // ── Fetch audit log ─────────────────────────────────────────────
  const loadAudit = useCallback(
    async (page: number, q: string, action: string) => {
      setAuditLoading(true);
      try {
        const params = new URLSearchParams({ apage: String(page) });
        if (q) params.set("aq", q);
        if (action) params.set("aaction", action);

        const res = await fetch(`/api/admin/audit?${params}`);
        if (res.status === 401) {
          window.location.href = "/api/admin/challenge?redirect=/admin";
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data: AuditData = await res.json();
        setAuditData(data);
      } catch (err) {
        console.error("Failed to load audit log:", err);
      } finally {
        setAuditLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!authChecked) return;
    loadAudit(auditPage, auditQuery, auditAction);
  }, [authChecked, auditPage, auditQuery, auditAction, loadAudit]);

  // ── Delete handler ──────────────────────────────────────────────
  const handleDelete = async (token: string) => {
    setDeleteToken(token);
    try {
      const res = await fetch(
        `/api/admin/delete?token=${encodeURIComponent(token)}`,
        {
          method: "DELETE",
        },
      );
      if (res.status === 401) {
        window.location.href = "/api/admin/challenge?redirect=/admin";
        return;
      }
      const data: { success?: boolean; error?: string } = await res.json();
      if (data.success) {
        if (tab === "shares") {
          loadShares(sharePage, shareQuery, shareShowAll);
        }
      } else {
        alert("Delete failed: " + (data.error || "Unknown error"));
      }
    } catch (err) {
      alert(
        "Network error: " + (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      setDeleteToken(null);
    }
  };

  // ── Render ──────────────────────────────────────────────────────
  const shareQD = sharesData;
  const audQD = auditData;

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Admin Panel</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
            <a
              href="/"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              ← Back to Home
            </a>
            <span className="mx-2">&middot;</span>
            <a
              href="/docs"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              API Docs
            </a>
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-neutral-200 dark:border-neutral-800">
        <TabBtn active={tab === "shares"} onClick={() => setTab("shares")}>
          Shares
        </TabBtn>
        <TabBtn active={tab === "audit"} onClick={() => setTab("audit")}>
          Audit Log
        </TabBtn>
        <TabBtn active={tab === "upload"} onClick={() => setTab("upload")}>
          Upload
        </TabBtn>
      </div>

      {/* ── Shares Tab ───────────────────────────────────────────── */}
      {tab === "shares" && (
        <>
          {shareQD && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
              <StatCard label="Total" value={String(shareQD.stats.total)} />
              <StatCard
                label="Active"
                value={String(shareQD.stats.active)}
                color="green"
              />
              <StatCard
                label="Expired"
                value={String(shareQD.stats.expired)}
                color="red"
              />
              <StatCard
                label="Total Size"
                value={fmtSize(shareQD.stats.totalBytes)}
              />
              <StatCard
                label="Active Size"
                value={fmtSize(shareQD.stats.activeBytes)}
                color="green"
              />
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 mb-4 items-start sm:items-center">
            <div className="flex gap-2 flex-1 w-full sm:w-auto">
              <input
                type="text"
                data-share-search
                defaultValue={shareQuery}
                placeholder="Search by filename or token…"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setShareQuery((e.target as HTMLInputElement).value);
                    setSharePage(1);
                  }
                }}
                className="flex-1 px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-0"
              />
              <button
                onClick={() => {
                  const input = document.querySelector<HTMLInputElement>(
                    "[data-share-search]",
                  );
                  setShareQuery(input?.value ?? "");
                  setSharePage(1);
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                Search
              </button>
            </div>
            <div className="flex gap-2">
              <ToggleBtn
                label="Show All"
                active={shareShowAll}
                onClick={() => {
                  setShareShowAll(true);
                  setSharePage(1);
                }}
              />
              <ToggleBtn
                label="Active Only"
                active={!shareShowAll}
                onClick={() => {
                  setShareShowAll(false);
                  setSharePage(1);
                }}
              />
            </div>
          </div>

          {sharesLoading ? (
            <LoadingSkeleton rows={8} cols={9} />
          ) : shareQD && shareQD.shares.length === 0 ? (
            <EmptyState msg="No shares found." />
          ) : shareQD ? (
            <>
              <div className="overflow-x-auto bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50">
                      <TH>Token</TH>
                      <TH>Filename</TH>
                      <TH align="right">Size</TH>
                      <TH className="hidden md:table-cell">Type</TH>
                      <TH className="hidden lg:table-cell">Created</TH>
                      <TH className="hidden lg:table-cell">Expires</TH>
                      <TH align="right" className="hidden sm:table-cell">
                        DLs
                      </TH>
                      <TH className="hidden xl:table-cell">IP</TH>
                      <TH align="center">Action</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {shareQD.shares.map((share) => {
                      const expired = isExpired(share.expires_at);
                      return (
                        <tr
                          key={share.token}
                          className={
                            "border-b border-neutral-100 dark:border-neutral-800/50 " +
                            "hover:bg-neutral-50 dark:hover:bg-neutral-800/30 transition-colors " +
                            (expired ? "opacity-60" : "")
                          }
                        >
                          <TD>
                            <a
                              href={`/d/${share.token}`}
                              className="text-blue-600 dark:text-blue-400 hover:underline font-mono"
                              target="_blank"
                              rel="noreferrer"
                            >
                              {share.token}
                            </a>
                          </TD>
                          <TD
                            title={share.filename}
                            className="max-w-[200px] truncate"
                          >
                            {share.filename}
                          </TD>
                          <TD
                            align="right"
                            className="font-mono text-xs tabular-nums"
                          >
                            {fmtSize(share.size_bytes)}
                          </TD>
                          <TD className="hidden md:table-cell text-xs text-neutral-500 max-w-[100px] truncate">
                            {share.content_type || "—"}
                          </TD>
                          <TD className="hidden lg:table-cell text-xs text-neutral-500 tabular-nums">
                            {fmtDate(share.created_at)}
                          </TD>
                          <TD
                            className={
                              "hidden lg:table-cell text-xs tabular-nums " +
                              (expired
                                ? "text-red-500"
                                : "text-green-600 dark:text-green-400")
                            }
                          >
                            {fmtDate(share.expires_at)}
                          </TD>
                          <TD
                            align="right"
                            className="hidden sm:table-cell font-mono text-xs tabular-nums"
                          >
                            {share.download_count}
                          </TD>
                          <TD className="hidden xl:table-cell text-xs text-neutral-500 font-mono">
                            {share.created_ip || "—"}
                          </TD>
                          <TD align="center">
                            <button
                              onClick={() => handleDelete(share.token)}
                              disabled={deleteToken === share.token}
                              className={
                                "px-2 py-1 text-xs font-medium rounded transition-colors " +
                                (deleteToken === share.token
                                  ? "text-neutral-400 cursor-not-allowed"
                                  : "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30")
                              }
                            >
                              {deleteToken === share.token ? "…" : "Delete"}
                            </button>
                          </TD>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {shareQD.totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-6 flex-wrap">
                  {shareQD.page > 1 && (
                    <PageBtn onClick={() => setSharePage(shareQD.page - 1)}>
                      ← Prev
                    </PageBtn>
                  )}
                  {pages(shareQD.page, shareQD.totalPages).map((p, i) =>
                    p === null ? (
                      <span key={`e-${i}`} className="px-2 text-neutral-400">
                        …
                      </span>
                    ) : (
                      <PageBtn
                        key={p}
                        active={p === shareQD.page}
                        onClick={() => setSharePage(p)}
                      >
                        {p}
                      </PageBtn>
                    ),
                  )}
                  {shareQD.page < shareQD.totalPages && (
                    <PageBtn onClick={() => setSharePage(shareQD.page + 1)}>
                      Next →
                    </PageBtn>
                  )}
                </div>
              )}

              <p className="text-center text-xs text-neutral-400 mt-8">
                Page {shareQD.page} of {shareQD.totalPages} &middot;{" "}
                {shareQD.totalShares} total share(s)
              </p>
            </>
          ) : null}
        </>
      )}

      {/* ── Audit Log Tab ────────────────────────────────────────── */}
      {tab === "audit" && (
        <>
          {audQD && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <StatCard
                label="Total Events"
                value={String(audQD.stats.total)}
              />
              <StatCard
                label="Unique IPs"
                value={String(audQD.stats.uniqueIps)}
              />
              <StatCard
                label="Last Event"
                value={
                  audQD.stats.lastTs ? fmtDuration(audQD.stats.lastTs) : "—"
                }
              />
              <StatCard label="Showing" value={String(audQD.entries.length)} />
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 mb-4 items-start sm:items-center">
            <div className="flex gap-2 flex-1 w-full sm:w-auto">
              <input
                type="text"
                data-audit-search
                defaultValue={auditQuery}
                placeholder="Search IP or share token…"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setAuditQuery((e.target as HTMLInputElement).value);
                    setAuditPage(1);
                  }
                }}
                className="flex-1 px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-0"
              />
              <select
                value={auditAction}
                onChange={(e) => {
                  setAuditAction(e.target.value);
                  setAuditPage(1);
                }}
                className="px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All actions</option>
                {(audQD?.actions ?? []).map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <button
                onClick={() => {
                  const input = document.querySelector<HTMLInputElement>(
                    "[data-audit-search]",
                  );
                  setAuditQuery(input?.value ?? "");
                  setAuditPage(1);
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                Filter
              </button>
            </div>
            <div className="flex gap-2 flex-wrap">
              {["init", "complete", "download", "delete"].map((act) => (
                <ToggleBtn
                  key={act}
                  label={act}
                  active={auditAction === act}
                  onClick={() => {
                    setAuditAction(auditAction === act ? "" : act);
                    setAuditPage(1);
                  }}
                />
              ))}
            </div>
          </div>

          {auditLoading ? (
            <LoadingSkeleton rows={6} cols={7} />
          ) : audQD && audQD.entries.length === 0 ? (
            <EmptyState msg="No audit log entries found." />
          ) : audQD ? (
            <>
              <div className="overflow-x-auto bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50">
                      <TH>ID</TH>
                      <TH>Timestamp</TH>
                      <TH>IP</TH>
                      <TH>Action</TH>
                      <TH>Share</TH>
                      <TH align="right">Status</TH>
                      <TH className="hidden lg:table-cell">Details</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {audQD.entries.map((e) => (
                      <tr
                        key={e.id}
                        className="border-b border-neutral-100 dark:border-neutral-800/50 hover:bg-neutral-50 dark:hover:bg-neutral-800/30 transition-colors"
                      >
                        <TD className="font-mono text-xs text-neutral-400">
                          {e.id}
                        </TD>
                        <TD
                          className="text-xs tabular-nums text-neutral-500"
                          title={fmtDate(e.ts)}
                        >
                          {fmtDuration(e.ts)}
                        </TD>
                        <TD className="font-mono text-xs text-neutral-600 dark:text-neutral-400">
                          {e.ip || "—"}
                        </TD>
                        <TD>
                          <ActionBadge action={e.action} />
                        </TD>
                        <TD>
                          {e.share_token ? (
                            <a
                              href={`/d/${e.share_token}`}
                              className="text-blue-600 dark:text-blue-400 hover:underline font-mono text-xs"
                              target="_blank"
                              rel="noreferrer"
                            >
                              {e.share_token}
                            </a>
                          ) : (
                            <span className="text-neutral-400">—</span>
                          )}
                        </TD>
                        <TD align="right">
                          <StatusBadge code={e.status} />
                        </TD>
                        <TD className="hidden lg:table-cell text-xs text-neutral-500 max-w-[300px] truncate">
                          {e.detail_json || "—"}
                        </TD>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {audQD.totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-6 flex-wrap">
                  {audQD.page > 1 && (
                    <PageBtn onClick={() => setAuditPage(audQD.page - 1)}>
                      ← Prev
                    </PageBtn>
                  )}
                  {pages(audQD.page, audQD.totalPages).map((p, i) =>
                    p === null ? (
                      <span key={`e-${i}`} className="px-2 text-neutral-400">
                        …
                      </span>
                    ) : (
                      <PageBtn
                        key={p}
                        active={p === audQD.page}
                        onClick={() => setAuditPage(p)}
                      >
                        {p}
                      </PageBtn>
                    ),
                  )}
                  {audQD.page < audQD.totalPages && (
                    <PageBtn onClick={() => setAuditPage(audQD.page + 1)}>
                      Next →
                    </PageBtn>
                  )}
                </div>
              )}

              <p className="text-center text-xs text-neutral-400 mt-8">
                Page {audQD.page} of {audQD.totalPages} &middot;{" "}
                {audQD.totalEntries} total entries
              </p>
            </>
          ) : null}
        </>
      )}

      {/* ── Upload Tab ──────────────────────────────────────────── */}
      {tab === "upload" && (
        <div className="max-w-2xl mx-auto">
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">
            Admin uploads bypass all quotas. Select "No expiry" for shares
            that never expire.
          </p>
          <Uploader
            maxSize={100 * 1024 * 1024 * 1024}
            ttlPresets={[
              { label: "No expiry", value: 0 },
              { label: "5 minutes", value: 300 },
              { label: "30 minutes", value: 1800 },
              { label: "1 hour", value: 3600 },
              { label: "6 hours", value: 21600 },
              { label: "24 hours", value: 86400 },
              { label: "3 days", value: 259200 },
              { label: "7 days", value: 604800 },
            ]}
          />
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Sub-components                                                    */
/* ================================================================== */

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "px-4 py-2.5 text-sm font-medium border-b-2 transition-colors " +
        (active
          ? "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400"
          : "border-transparent text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300")
      }
    >
      {children}
    </button>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: "green" | "red";
}) {
  const colorClass =
    color === "green"
      ? "text-green-600 dark:text-green-400"
      : color === "red"
        ? "text-red-500"
        : "text-neutral-500";
  return (
    <div className="bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-800 p-3">
      <div className={"text-xs uppercase tracking-wider " + colorClass}>
        {label}
      </div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </div>
  );
}

function TH({
  children,
  align,
  className,
}: {
  children: React.ReactNode;
  align?: "right" | "center";
  className?: string;
}) {
  const base =
    "text-left px-3 py-2.5 font-medium text-neutral-500 text-xs uppercase tracking-wider";
  const alignClass =
    align === "right" ? "text-right" : align === "center" ? "text-center" : "";
  return (
    <th className={`${base} ${alignClass} ${className ?? ""}`}>{children}</th>
  );
}

function TD({
  children,
  align,
  className,
  title,
}: {
  children: React.ReactNode;
  align?: "right" | "center";
  className?: string;
  title?: string;
}) {
  const alignClass =
    align === "right" ? "text-right" : align === "center" ? "text-center" : "";
  return (
    <td
      className={`px-3 py-2.5 ${alignClass} ${className ?? ""}`}
      title={title}
    >
      {children}
    </td>
  );
}

function ToggleBtn({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const activeClass = "bg-blue-600 text-white border-blue-600";
  const inactiveClass =
    "bg-white dark:bg-neutral-900 border-neutral-300 dark:border-neutral-700 " +
    "hover:bg-neutral-100 dark:hover:bg-neutral-800";
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${active ? activeClass : inactiveClass}`}
    >
      {label}
    </button>
  );
}

function PageBtn({
  onClick,
  children,
  active,
}: {
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
}) {
  const activeClass = "bg-blue-600 text-white";
  const inactiveClass =
    "border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800";
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${active ? activeClass : inactiveClass}`}
    >
      {children}
    </button>
  );
}

function ActionBadge({ action }: { action: string }) {
  const colorMap: Record<string, string> = {
    init: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    complete:
      "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
    download:
      "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
    expire:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
    delete: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    admin_view: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  };
  const cls =
    colorMap[action] ??
    "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}
    >
      {action}
    </span>
  );
}

function StatusBadge({ code }: { code: number | null }) {
  if (code === null) return <span className="text-neutral-400">—</span>;
  const color =
    code < 300
      ? "text-green-600 dark:text-green-400"
      : code < 400
        ? "text-blue-600"
        : "text-red-500";
  return (
    <span className={`font-mono text-xs tabular-nums ${color}`}>{code}</span>
  );
}

function LoadingSkeleton({ rows }: { rows: number; cols?: number }) {
  return (
    <div className="bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-800 p-6">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-8 bg-neutral-100 dark:bg-neutral-800 rounded mb-2 animate-pulse"
          style={{ width: `${50 + Math.random() * 40}%` }}
        />
      ))}
    </div>
  );
}

function EmptyState({ msg }: { msg: string }) {
  return (
    <div className="bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-800 p-12 text-center text-neutral-400">
      {msg}
    </div>
  );
}

/* ================================================================== */
/*  Pagination helper                                                 */
/* ================================================================== */

function pages(current: number, total: number): (number | null)[] {
  if (total <= 10) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const result: (number | null)[] = [];
  const start = Math.max(1, current - 4);
  const end = Math.min(total, current + 4);
  if (start > 1) {
    result.push(1);
    if (start > 2) result.push(null);
  }
  for (let i = start; i <= end; i++) result.push(i);
  if (end < total) {
    if (end < total - 1) result.push(null);
    result.push(total);
  }
  return result;
}
