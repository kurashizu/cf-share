"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { FileItem, type UploadState } from "./FileItem";
import { ResultPanel } from "./ResultPanel";

/** Number of samples to keep for speed calculation (rolling window). */
const SPEED_SAMPLES = 10;

interface CompletedUpload {
  shareToken: string;
  shareUrl: string;
  fullUrl: string;
  expiresAt: number;
  filename: string;
  size: number;
  startedAt: number;
}

interface SpeedSample {
  loaded: number;
  at: number;
}

interface ActiveUpload {
  file: File;
  state: UploadState;
  xhr: XMLHttpRequest | null;
  uploadId: string | null;
  startedAt: number;
  /** Rolling bytes-loaded samples for speed calculation. */
  speedSamples: SpeedSample[];
}

interface SingleInitResponse {
  mode: "single";
  uploadId: string;
  key: string;
  url: string;
  headers: Record<string, string>;
  expiresIn: number;
}

interface PartPresign {
  partNumber: number;
  url: string;
  size: number;
}

interface MultipartInitResponse {
  mode: "multipart";
  uploadId: string;
  s3UploadId: string;
  key: string;
  parts: PartPresign[];
  partSize: number;
  expiresIn: number;
}

type InitResponse = SingleInitResponse | MultipartInitResponse;

const MAX_SIZE = 5 * 1024 * 1024 * 1024; // 5 GB

const TTL_PRESETS = [
  { label: "5 minutes", value: 300 },
  { label: "30 minutes", value: 1800 },
  { label: "1 hour", value: 3600 },
  { label: "6 hours", value: 21600 },
  { label: "24 hours", value: 86400 },
  { label: "3 days", value: 259200 },
  { label: "7 days", value: 604800 },
];

export function Uploader() {
  const [active, setActive] = useState<ActiveUpload | null>(null);
  const [completed, setCompleted] = useState<CompletedUpload | null>(null);
  const [ttl, setTtl] = useState(TTL_PRESETS[4].value); // default 24h
  const [password, setPassword] = useState("");
  const cancelledRef = useRef(false);

  // Warn user before closing tab during an active upload
  useEffect(() => {
    if (
      active &&
      (active.state.kind === "uploading" || active.state.kind === "preparing")
    ) {
      const handler = (e: BeforeUnloadEvent) => {
        e.preventDefault();
      };
      window.addEventListener("beforeunload", handler);
      return () => window.removeEventListener("beforeunload", handler);
    }
  }, [active]);

  const startUpload = useCallback(
    async (file: File) => {
      cancelledRef.current = false;
      const startedAt = Date.now();
      setCompleted(null);

      // Get current values from state via snapshot
      const currentTtl = ttl;
      const currentPassword = password;

      // 1. init
      setActive({
        file,
        state: { kind: "preparing" },
        xhr: null,
        uploadId: null,
        startedAt,
        speedSamples: [],
      });

      let init: InitResponse;
      try {
        const resp = await fetch("/api/upload/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            size: file.size,
            contentType: file.type || "application/octet-stream",
            ttl: currentTtl,
            password: currentPassword || undefined,
          }),
        });
        if (!resp.ok) {
          const txt = await resp.text();
          throw new Error(`init ${resp.status}: ${txt}`);
        }
        init = (await resp.json()) as InitResponse;
      } catch (err) {
        setActive({
          file,
          state: {
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          },
          xhr: null,
          uploadId: null,
          startedAt,
          speedSamples: [],
        });
        return;
      }

      setActive((prev) =>
        prev && prev.file === file
          ? { ...prev, uploadId: init.uploadId }
          : prev,
      );

      if (init.mode === "multipart") {
        await doMultipartUpload(
          file,
          init,
          startedAt,
          currentTtl,
          currentPassword,
        );
      } else {
        await doSingleUpload(
          file,
          init,
          startedAt,
          currentTtl,
          currentPassword,
        );
      }
    },
    [ttl, password],
  );

  /** Update active state with progress and speed tracking. */
  function setProgress(
    file: File,
    loaded: number,
    total: number,
    partInfo?: string,
  ) {
    setActive((prev) => {
      if (!prev || prev.file !== file) return prev;
      const now = Date.now();
      const samples = [...prev.speedSamples, { loaded, at: now }].slice(
        -SPEED_SAMPLES,
      );
      // Calculate speed: (latest - earliest) / time_delta
      let speed = 0;
      if (samples.length >= 2) {
        const first = samples[0];
        const last = samples[samples.length - 1];
        const deltaBytes = last.loaded - first.loaded;
        const deltaMs = last.at - first.at;
        if (deltaMs > 200) {
          speed = (deltaBytes / deltaMs) * 1000; // bytes/sec
        }
      }
      return {
        ...prev,
        speedSamples: samples,
        state: {
          kind: "uploading" as const,
          progress: total > 0 ? loaded / total : 0,
          loaded,
          total,
          speed,
          partInfo,
        },
      };
    });
  }

  /** Single PUT upload (files ≤ ~90 MB). */
  async function doSingleUpload(
    file: File,
    init: SingleInitResponse,
    startedAt: number,
    currentTtl: number,
    currentPassword: string,
  ) {
    // 2. PUT to S3 via XHR
    const xhr = new XMLHttpRequest();
    setActive({
      file,
      state: {
        kind: "uploading",
        progress: 0,
        loaded: 0,
        total: file.size,
        speed: 0,
      },
      xhr,
      uploadId: init.uploadId,
      startedAt,
      speedSamples: [],
    });

    const done = new Promise<{ etag: string }>((resolve, reject) => {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          setProgress(file, e.loaded, e.total);
        }
      });
      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const etag =
            xhr.getResponseHeader("etag") ||
            xhr.getResponseHeader("ETag") ||
            "";
          resolve({ etag: etag.replace(/"/g, "") });
        } else {
          reject(
            new Error(`PUT ${xhr.status}: ${xhr.responseText.slice(0, 200)}`),
          );
        }
      });
      xhr.addEventListener("error", () => reject(new Error("Network error")));
      xhr.addEventListener("abort", () => reject(new Error("Cancelled")));
    });

    xhr.open("PUT", init.url);
    for (const [k, v] of Object.entries(init.headers)) {
      xhr.setRequestHeader(k, v);
    }
    xhr.send(file);

    let etag: string;
    try {
      ({ etag } = await done);
    } catch (err) {
      if (cancelledRef.current) return;
      setActive({
        file,
        state: {
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        },
        xhr: null,
        uploadId: null,
        startedAt,
        speedSamples: [],
      });
      return;
    }

    if (cancelledRef.current) return;

    await completeUpload(
      file,
      {
        uploadId: init.uploadId,
        key: init.key,
        etag,
        mode: "single",
      },
      startedAt,
      currentTtl,
      currentPassword,
    );
  }

  /** Multipart upload (files > ~90 MB, split into 50 MB parts). */
  async function doMultipartUpload(
    file: File,
    init: MultipartInitResponse,
    startedAt: number,
    currentTtl: number,
    currentPassword: string,
  ) {
    const parts = init.parts;
    const completedParts: { partNumber: number; etag: string }[] = [];
    let totalLoaded = 0;
    const totalSize = file.size;

    // Upload each part sequentially, accumulating progress
    for (let i = 0; i < parts.length; i++) {
      if (cancelledRef.current) return;

      const part = parts[i];
      const start = (part.partNumber - 1) * init.partSize;
      const end = Math.min(start + part.size, file.size);
      const blob = file.slice(start, end);

      const xhr = new XMLHttpRequest();

      const uploaded = await new Promise<{ etag: string }>(
        (resolve, reject) => {
          // Must open + send INSIDE the executor so the promise resolves on load
          xhr.open("PUT", part.url);
          // Multipart presigned URLs already have the signature baked in;
          // no additional headers needed.

          xhr.upload.addEventListener("progress", (e) => {
            if (e.lengthComputable) {
              const partProgress = totalLoaded + e.loaded;
              setProgress(
                file,
                partProgress,
                totalSize,
                `Part ${part.partNumber}/${parts.length}`,
              );
            }
          });
          xhr.addEventListener("load", () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              const etag =
                xhr.getResponseHeader("etag") ||
                xhr.getResponseHeader("ETag") ||
                "";
              resolve({ etag: etag.replace(/"/g, "") });
            } else {
              reject(
                new Error(
                  `Part ${part.partNumber} PUT ${xhr.status}: ${xhr.responseText.slice(0, 200)}`,
                ),
              );
            }
          });
          xhr.addEventListener("error", () =>
            reject(new Error(`Part ${part.partNumber} network error`)),
          );
          xhr.addEventListener("abort", () => reject(new Error("Cancelled")));

          xhr.send(blob);
        },
      );

      totalLoaded += part.size;
      completedParts.push({ partNumber: part.partNumber, etag: uploaded.etag });
    }

    if (cancelledRef.current) return;

    await completeUpload(
      file,
      {
        uploadId: init.uploadId,
        key: init.key,
        mode: "multipart",
        s3UploadId: init.s3UploadId,
        parts: completedParts,
      },
      startedAt,
      currentTtl,
      currentPassword,
    );
  }

  /** Common complete step for both single and multipart. */
  async function completeUpload(
    file: File,
    completePayload: Record<string, unknown>,
    startedAt: number,
    currentTtl: number,
    currentPassword: string,
  ) {
    if (cancelledRef.current) return;

    setActive((prev) =>
      prev && prev.file === file
        ? { ...prev, state: { kind: "success", etag: "—" }, xhr: null }
        : prev,
    );

    try {
      const body = {
        ...completePayload,
        filename: file.name,
        size: file.size,
        contentType: file.type || "application/octet-stream",
        ttl: currentTtl,
        password: currentPassword || undefined,
      };

      const r = await fetch("/api/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(`complete ${r.status}: ${txt}`);
      }
      const data = (await r.json()) as {
        shareToken: string;
        shareUrl: string;
        fullUrl: string;
        expiresAt: number;
      };
      setCompleted({
        shareToken: data.shareToken,
        shareUrl: data.shareUrl,
        fullUrl: data.fullUrl,
        expiresAt: data.expiresAt,
        filename: file.name,
        size: file.size,
        startedAt,
      });
    } catch (err) {
      setActive({
        file,
        state: {
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        },
        xhr: null,
        uploadId: null,
        startedAt,
        speedSamples: [],
      });
    }
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (acceptedFiles) => {
      if (acceptedFiles.length === 0) return;
      startUpload(acceptedFiles[0]);
    },
    maxFiles: 1,
    maxSize: MAX_SIZE,
    multiple: false,
    noClick: active !== null && active.state.kind !== "error",
  });

  const cancel = () => {
    cancelledRef.current = true;
    if (active?.xhr) {
      active.xhr.abort();
    }
    setActive(null);
  };

  const retry = () => {
    if (active) startUpload(active.file);
  };

  return (
    <div className="w-full max-w-xl space-y-4">
      {/* TTL selector — always visible */}
      <div className="flex items-center gap-3 text-sm">
        <label
          htmlFor="ttl-select"
          className="text-neutral-600 dark:text-neutral-400 font-medium whitespace-nowrap"
        >
          Link expires in:
        </label>
        <select
          id="ttl-select"
          value={ttl}
          onChange={(e) => setTtl(Number(e.target.value))}
          disabled={active !== null && active.state.kind !== "error"}
          className="flex-1 px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        >
          {TTL_PRESETS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Password — optional */}
      <div className="flex items-center gap-3 text-sm">
        <label
          htmlFor="password-input"
          className="text-neutral-600 dark:text-neutral-400 font-medium whitespace-nowrap"
        >
          Password:
        </label>
        <input
          id="password-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Leave empty for no password"
          disabled={active !== null && active.state.kind !== "error"}
          className="flex-1 px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />
      </div>

      <div
        {...getRootProps()}
        className={`
						border-2 border-dashed rounded-xl p-10 text-center cursor-pointer
						transition-colors
						${
              isDragActive
                ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20"
                : "border-neutral-300 dark:border-neutral-700 hover:border-neutral-400 dark:hover:border-neutral-600"
            }
						${active && active.state.kind !== "error" ? "pointer-events-none opacity-60" : ""}
					`}
      >
        <input {...getInputProps()} />
        <p className="text-lg font-medium text-neutral-700 dark:text-neutral-200">
          {isDragActive ? "Drop the file here..." : "Drag & drop a file here"}
        </p>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          or click to select · Max 5 GB · Any file type
        </p>
      </div>

      {active && (
        <FileItem
          file={active.file}
          state={active.state}
          onCancel={cancel}
          onRetry={retry}
        />
      )}

      {completed && (
        <ResultPanel
          shareToken={completed.shareToken}
          shareUrl={completed.shareUrl}
          fullUrl={completed.fullUrl}
          expiresAt={completed.expiresAt}
          filename={completed.filename}
          size={completed.size}
          startedAt={completed.startedAt}
        />
      )}
    </div>
  );
}
