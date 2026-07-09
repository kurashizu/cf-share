"use client";

import { useEffect, useRef, useState } from "react";

export type UploadState =
  | { kind: "idle" }
  | { kind: "preparing" }
  | { kind: "uploading"; progress: number; partInfo?: string }
  | { kind: "success"; etag: string }
  | { kind: "error"; message: string };

interface Props {
  file: File;
  state: UploadState;
  onCancel: () => void;
  onRetry: () => void;
}

/**
 * Render a single file row with progress + cancel/retry buttons.
 *
 * Upload is performed by the parent (Uploader) using an XHR so we can track
 * upload progress reliably. This component is purely visual.
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
                    : state.kind === "preparing"
                      ? "0%"
                      : "0%",
            }}
          />
        </div>

        <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400 h-4">
          {state.kind === "idle" && "Waiting..."}
          {state.kind === "preparing" && "Requesting upload URL..."}
          {state.kind === "uploading" && (
            <>
              {Math.round(state.progress * 100)}%
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
