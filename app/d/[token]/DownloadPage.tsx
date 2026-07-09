"use client";

import { useCallback, useEffect, useState } from "react";

interface ShareInfo {
  filename: string;
  size_bytes: number;
  content_type: string;
  expires_at: number;
  download_count: number;
  has_password?: boolean;
}

interface Props {
  token: string;
}

type PageStatus =
  | "loading"
  | "ok"
  | "missing"
  | "expired"
  | "password-required"
  | "wrong-password"
  | "downloading";

/**
 * The human-facing download page for /d/:token.
 *
 * Supports password-protected shares: if has_password is true, shows a
 * password prompt. Password is verified via POST /api/download/:token.
 */
export function DownloadPage({ token }: Props) {
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [status, setStatus] = useState<PageStatus>("loading");
  const [password, setPassword] = useState("");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/download/${token}?info=1`, {
          cache: "no-store",
        });
        if (cancelled) return;
        if (r.status === 404) {
          setStatus("missing");
          return;
        }
        if (!r.ok) {
          setStatus("missing");
          return;
        }
        const data = (await r.json()) as ShareInfo;
        setInfo(data);
        if (data.has_password) {
          setStatus("password-required");
        } else {
          setStatus("ok");
        }
      } catch {
        if (!cancelled) setStatus("missing");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const download = useCallback(() => {
    window.location.href = `/api/download/${token}`;
  }, [token]);

  const downloadWithPassword = useCallback(async () => {
    if (!password) {
      setErrorMsg("Please enter a password.");
      return;
    }
    setVerifying(true);
    setErrorMsg("");
    try {
      const r = await fetch(`/api/download/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (r.status === 401) {
        setStatus("wrong-password");
        setErrorMsg("Invalid password. Please try again.");
        return;
      }
      if (r.status === 404) {
        setStatus("missing");
        return;
      }
      if (!r.ok) {
        throw new Error(`HTTP ${r.status}`);
      }
      const data = (await r.json()) as {
        verified?: boolean;
        downloadUrl?: string;
        error?: string;
      };
      if (data.verified && data.downloadUrl) {
        setDownloadUrl(data.downloadUrl);
        setVerifying(false);
        // Open the presigned S3 URL in a new tab. This avoids navigating
        // the current page away, so the UI doesn't stay stuck at
        // "Verifying…".
        const win = window.open(data.downloadUrl, "_blank");
        if (!win) {
          // Popup blocker — fall back to same-window navigation.
          window.location.href = data.downloadUrl;
        }
      } else {
        throw new Error(data.error || "Verification failed");
      }
    } catch (err) {
      setVerifying(false);
      setErrorMsg(
        err instanceof Error ? err.message : "Network error. Please try again.",
      );
      setStatus("wrong-password");
    }
  }, [token, password]);

  const retryPassword = () => {
    setStatus("password-required");
    setErrorMsg("");
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 p-6">
      <div className="w-full max-w-md">
        {status === "loading" && (
          <div className="text-center text-neutral-500 dark:text-neutral-400">
            Loading…
          </div>
        )}

        {status === "missing" && (
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
              Link not found
            </h1>
            <p className="text-neutral-600 dark:text-neutral-400">
              This share link doesn&apos;t exist or has been removed.
            </p>
          </div>
        )}

        {status === "expired" && (
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
              Link expired
            </h1>
            <p className="text-neutral-600 dark:text-neutral-400">
              This share has expired and the file has been deleted.
            </p>
          </div>
        )}

        {status === "password-required" && info && (
          <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-6 bg-white dark:bg-neutral-900 space-y-4">
            <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50 break-all">
              {info.filename}
            </h1>
            <dl className="text-sm space-y-1 text-neutral-600 dark:text-neutral-400">
              <div className="flex justify-between">
                <dt>Size</dt>
                <dd>{formatBytes(info.size_bytes)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Type</dt>
                <dd className="font-mono text-xs">{info.content_type}</dd>
              </div>
            </dl>
            <div className="border-t border-neutral-200 dark:border-neutral-700 pt-4">
              <p className="text-sm text-amber-600 dark:text-amber-400 font-medium mb-2">
                🔒 This file is password-protected
              </p>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") downloadWithPassword();
                }}
                placeholder="Enter password"
                autoFocus
                className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
              />
              {errorMsg && (
                <p className="text-xs text-red-600 dark:text-red-400 mb-3">
                  {errorMsg}
                </p>
              )}
              <button
                onClick={downloadWithPassword}
                disabled={verifying}
                className="w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium"
              >
                {verifying ? "Verifying…" : "Download"}
              </button>
            </div>
          </div>
        )}

        {status === "wrong-password" && info && (
          <div className="border border-red-200 dark:border-red-900 rounded-xl p-6 bg-white dark:bg-neutral-900 space-y-4">
            <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50 break-all">
              {info.filename}
            </h1>
            <p className="text-sm text-red-600 dark:text-red-400">
              {errorMsg || "Invalid password."}
            </p>
            <button
              onClick={retryPassword}
              className="w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium"
            >
              Try Again
            </button>
          </div>
        )}

        {status === "ok" && info && !info.has_password && (
          <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-6 bg-white dark:bg-neutral-900 space-y-4">
            <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50 break-all">
              {info.filename}
            </h1>
            <dl className="text-sm space-y-1 text-neutral-600 dark:text-neutral-400">
              <div className="flex justify-between">
                <dt>Size</dt>
                <dd>{formatBytes(info.size_bytes)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Type</dt>
                <dd className="font-mono text-xs">{info.content_type}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Downloads</dt>
                <dd>{info.download_count}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Expires</dt>
                <dd>{formatRelativeTime(info.expires_at)}</dd>
              </div>
            </dl>
            <button
              onClick={download}
              className="w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium"
            >
              Download
            </button>
            <p className="text-xs text-neutral-500 dark:text-neutral-500 text-center">
              Direct link:{" "}
              <code className="bg-neutral-100 dark:bg-neutral-800 px-1 py-0.5 rounded">
                /api/download/{token}
              </code>
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatRelativeTime(ts: number): string {
  const diff = ts - Date.now();
  if (diff < 0) return "expired";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.floor(hours / 24);
  return `in ${days}d`;
}
