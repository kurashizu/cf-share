"use client";

/**
 * Resume state persisted to localStorage so an interrupted upload can
 * pick up where it left off after a page refresh / tab close.
 *
 * Shape:
 *   key = sha256-ish fingerprint of (filename, size, contentType, lastModified)
 *   value = { s3UploadId, key, size, completedParts: [{partNumber, etag}], savedAt }
 *
 * Storage key prefix is namespaced under "cf-share:upload:" so it doesn't
 * collide with anything else.
 *
 * We deliberately use the file's lastModified timestamp in the fingerprint
 * so that re-selecting a file with the same name+size+type but different
 * content (e.g. user re-edited and re-saved it) doesn't accidentally resume
 * against the old upload.
 */

const KEY_PREFIX = "cf-share:upload:";

export interface PersistedPart {
  partNumber: number;
  etag: string;
}

export interface PersistedUpload {
  s3UploadId: string;
  key: string;
  size: number;
  completedParts: PersistedPart[];
  /** Unix ms when this state was last updated. */
  savedAt: number;
}

/** Best-effort async SHA-256 of a string, hex-encoded. */
async function sha256Hex(s: string): Promise<string> {
  const enc = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Build a stable fingerprint for a file. Falls back to a random id if
 * File.lastModified / File.type are missing (which only happens on File
 * objects constructed from Blobs, not real <input type=file>).
 */
export async function fileFingerprint(file: File): Promise<string> {
  const s = [
    file.name,
    String(file.size),
    file.type || "",
    String(file.lastModified || ""),
  ].join("|");
  return sha256Hex(s);
}

function storageKey(fp: string): string {
  return KEY_PREFIX + fp;
}

/** Read a persisted upload state, or null if none / parse error. */
export function loadPersistedUpload(fp: string): PersistedUpload | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey(fp));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedUpload;
    // Light validation: catch obvious tampering.
    if (
      typeof parsed.s3UploadId !== "string" ||
      typeof parsed.key !== "string" ||
      typeof parsed.size !== "number" ||
      !Array.isArray(parsed.completedParts)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Persist upload state. Throws are swallowed — storage failures shouldn't
 *  block the upload itself. */
export function savePersistedUpload(fp: string, state: PersistedUpload): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey(fp), JSON.stringify(state));
  } catch {
    // QuotaExceeded, private mode, etc. — non-fatal.
  }
}

/** Drop the persisted state for a fingerprint (called on successful complete). */
export function clearPersistedUpload(fp: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(storageKey(fp));
  } catch {
    // ignore
  }
}

/**
 * Garbage-collect any persisted uploads older than `maxAgeMs`. Useful on
 * startup to evict uploads from past sessions that the user abandoned
 * long enough ago that they're no longer recoverable (S3 multipart TTL is
 * 1h, so anything older than ~2h is certainly dead).
 *
 * Returns the number of entries removed.
 */
export function gcPersistedUploads(maxAgeMs: number): number {
  if (typeof localStorage === "undefined") return 0;
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(KEY_PREFIX)) continue;
      try {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as PersistedUpload;
        if (!parsed.savedAt || parsed.savedAt < cutoff) {
          toRemove.push(k);
        }
      } catch {
        toRemove.push(k);
      }
    }
    for (const k of toRemove) {
      localStorage.removeItem(k);
      removed++;
    }
  } catch {
    // ignore
  }
  return removed;
}