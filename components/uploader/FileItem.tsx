"use client";

import { useEffect, useRef, useState } from "react";

export type UploadState =
  | { kind: "idle" }
  | { kind: "preparing" }
  | {
      kind: "uploading";
      progress: number;
      loaded: number;
      total: number;
      speed: number; // bytes/sec
      partInfo?: string;
    }
  | { kind: "success"; etag: string }
  | { kind: "error"; message: string };

interface Props {
  file: File;
  state: UploadState;
  onCancel: () => void;
  onRetry: () => void;
}

/** Format bytes to human-readable string. */
function fmtBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + " " + units[i];
}

/** Format speed (bytes/sec) to a human-readable string. */
function fmtSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return "";
  if (bytesPerSec >= 1_000_000)
    return (bytesPerSec / 1_000_000).toFixed(1) + " MB/s";
  if (bytesPerSec >= 1_000) return (bytesPerSec / 1_000).toFixed(1) + " KB/s";
  return Math.round(bytesPerSec) + " B/s";
}

/** Estimate remaining time in seconds given progress and speed. */
function estimateRemaining(
  progress: number,
  speed: number,
  total: number,
  loaded: number,
): string {
  if (speed <= 0 || progress >= 1) return "";
  const remaining = total - loaded;
  const sec = remaining / speed;
  if (sec < 5) return "";
  if (sec < 60) return ` · ${Math.round(sec)}s remaining`;
  if (sec < 3600)
    return ` · ${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s remaining`;
  return ` · ${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m remaining`;
}

/**
 * Render a single file row with progress, speed, ETA + cancel/retry buttons.
 */
export function FileItem({ file, state, onCancel, onRetry }: Props) {
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const sizeKB = (file.size / 1024).toFixed(1);
  const isWorking = state.kind === "preparing" || state.kind === "uploading";

  return (
    <div className="flex items-center gap-3 p-3 border border-neutral-200 dark:border-neutral-800 rounded-lg">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-medium text-neutral-900 dark:text-neutral-50">
            {file.name}
          </span>
          <span className="text-xs text-neutral-500 dark:text-neutral-400 shrink-0">
            {sizeKB} KB
          </span>
        </div>

        <div className="mt-2 h-1.5 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${
              state.kind === "error"
                ? "bg-red-500"
                : state.kind === "success"
                  ? "bg-green-500"
                  : "bg-blue-500"
            }`}
            style={{
              width:
                state.kind === "uploading"
                  ? `${Math.round(state.progress * 100)}%`
                  : state.kind === "success"
                    ? "100%"
                    : "0%",
            }}
          />
        </div>

        <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400 h-4 leading-tight">
          {state.kind === "idle" && "Waiting..."}
          {state.kind === "preparing" && "Requesting upload URL..."}
          {state.kind === "uploading" && (
            <>
              <span className="tabular-nums">
                {Math.round(state.progress * 100)}%
              </span>
              <span className="ml-1 text-neutral-400 tabular-nums">
                {fmtBytes(state.loaded)} / {fmtBytes(state.total)}
              </span>
              {state.speed > 0 && (
                <span className="ml-1 text-neutral-400 tabular-nums">
                  · {fmtSpeed(state.speed)}
                  {estimateRemaining(
                    state.progress,
                    state.speed,
                    state.total,
                    state.loaded,
                  )}
                </span>
              )}
              {state.partInfo && (
                <span className="ml-1 text-neutral-400">{state.partInfo}</span>
              )}
            </>
          )}
          {state.kind === "success" &&
            `Uploaded · ${state.etag.slice(0, 12)}...`}
          {state.kind === "error" && (
            <span className="text-red-600 dark:text-red-400">
              Error: {state.message}
            </span>
          )}
        </div>
      </div>

      <div className="shrink-0">
        {isWorking && (
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded-md border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
        )}
        {state.kind === "error" && (
          <button
            onClick={onRetry}
            className="px-3 py-1.5 text-sm rounded-md bg-blue-600 hover:bg-blue-700 text-white"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
