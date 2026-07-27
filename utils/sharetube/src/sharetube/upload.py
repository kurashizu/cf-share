"""
Upload a local file to share.krsz.in via the /api/upload/{init,complete} flow.

API shape (verified against cf-share HEAD):
  init → single : { mode, uploadId, key, url, headers, expiresIn }
  init → multipart: { mode, uploadId, s3UploadId, key,
                       parts:[{partNumber, url, size}], partSize, expiresIn }
  complete single : { uploadId, key, filename, size, contentType, etag, ttl }
  complete multi  : { mode:"multipart", uploadId, s3UploadId, key, filename,
                       size, contentType, parts:[{partNumber, etag}], ttl }
  response      : { shareToken, shareUrl, fullUrl, expiresAt }
"""
from __future__ import annotations

import base64
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterator, Optional

import httpx

from .config import Config


def _fmt_bytes(n: int | float | None) -> str:
    """Format a byte count as a human-readable string."""
    if n is None or n < 0:
        return ""
    if n < 1024:
        return f"{int(n)} B"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f} KB"
    if n < 1024 * 1024 * 1024:
        return f"{n / 1024 / 1024:.1f} MB"
    return f"{n / 1024 / 1024 / 1024:.2f} GB"


@dataclass
class UploadResult:
    share_token: str
    share_url: str
    expires_at: int


def _maybe_admin_headers() -> Optional[dict[str, str]]:
    user = os.environ.get("CF_SHARE_ADMIN_USER")
    pw = os.environ.get("CF_SHARE_ADMIN_PASS")
    if not user or not pw:
        return None
    raw = f"{user}:{pw}".encode()
    return {"Authorization": "Basic " + base64.b64encode(raw).decode()}


def _guess_content_type(filename: str) -> str:
    n = filename.lower()
    if n.endswith(".mp4"):
        return "video/mp4"
    if n.endswith(".m4v"):
        return "video/x-m4v"
    if n.endswith(".mkv"):
        return "video/x-matroska"
    if n.endswith(".webm"):
        return "video/webm"
    if n.endswith(".mov"):
        return "video/quicktime"
    return "application/octet-stream"


def upload(
    src: Path,
    cfg: Config,
    on_log: Callable[[str], None],
    on_progress: Callable[[float, str], None],
    filename: str | None = None,
) -> UploadResult:
    headers = _maybe_admin_headers() or {}
    admin = bool(headers)
    on_log(f"Upload mode: {'admin' if admin else 'anonymous'}")

    size = src.stat().st_size
    if not filename:
        filename = src.name
    ctype = _guess_content_type(filename)
    # Clamp to the cf-share server-side range: 5 min .. 7 days.
    # Server-side validation re-clamps; we just sanitise defensively
    # so we don't waste a roundtrip.
    ttl = max(300, min(7 * 24 * 60 * 60, int(cfg.ttl_seconds)))
    on_log(f"TTL: {ttl} s ({ttl // 3600}h{ttl % 3600 // 60:02d}m)")

    with httpx.Client(base_url=cfg.app_url, timeout=60.0) as client:
        # ── 1. init ────────────────────────────────────────────────────────
        on_log(f"POST /api/upload/init  size={size} name={filename}")
        init_resp = client.post(
            "/api/upload/init",
            json={
                "filename": filename,
                "size": size,
                "contentType": ctype,
                "ttl": ttl,
            },
            headers=headers,
        )
        init_resp.raise_for_status()
        init = init_resp.json()
        mode = init["mode"]

        if mode == "single":
            on_log(f"Mode: single PUT (url valid {init.get('expiresIn', '?')}s)")
            put_url = init["url"]
            upload_id = init["uploadId"]
            key = init["key"]

            # S3 presigned URLs REQUIRE a Content-Length header and
            # reject chunked transfer encoding (HTTP 411). We stream
            # the file in chunks to report byte-level progress.
            on_progress(0.0, f"Uploading {_fmt_bytes(size)}…")
            on_log(f"PUT {size:,} bytes → S3 (single PUT)")
            sent = 0
            last_reported = -1.0
            chunk_size = 1024 * 1024  # 1 MB

            def _stream() -> typing.Iterator[bytes]:
                nonlocal sent, last_reported
                with open(src, "rb") as f:
                    while True:
                        chunk = f.read(chunk_size)
                        if not chunk:
                            break
                        sent += len(chunk)
                        pct = sent / size * 100.0 if size else 100.0
                        if pct - last_reported >= 1.0 or pct >= 100.0:
                            last_reported = pct
                            on_progress(
                                min(100.0, pct),
                                f"{pct:.0f}% {_fmt_bytes(sent)}/{_fmt_bytes(size)}",
                            )
                        yield chunk

            put_resp = client.put(
                put_url,
                content=_stream(),
                headers={
                    "Content-Type": ctype,
                    "Content-Length": str(size),
                },
            )
            put_resp.raise_for_status()
            on_progress(100.0, f"{_fmt_bytes(size)} uploaded")
            etag = (
                put_resp.headers.get("etag")
                or put_resp.headers.get("ETag")
                or ""
            ).strip().strip('"')
            if not etag:
                raise RuntimeError("S3 PUT returned no ETag header")
            on_progress(100.0, f"{size:,} bytes uploaded")

            complete_body = {
                "uploadId": upload_id,
                "key": key,
                "filename": filename,
                "size": size,
                "contentType": ctype,
                "etag": etag,
                "ttl": ttl,
            }
        elif mode == "multipart":
            parts = init["parts"]
            total_parts = len(parts)
            on_log(f"Mode: multipart, {total_parts} parts × {init.get('partSize', '?')}B")
            upload_id = init["uploadId"]
            s3_upload_id = init["s3UploadId"]
            key = init["key"]

            # Multipart part URLs (R2/S3) require a literal
            # Content-Length matching the part size. We pre-slice the
            # file into the exact part bytes and PUT each one as a
            # single buffer, which lets httpx set Content-Length
            # automatically. Progress is reported per part by byte
            # fraction.
            data = src.read_bytes()
            sent = 0
            last_reported = -1.0
            completed: list[dict] = []
            for i, part in enumerate(parts, 1):
                chunk = data[: part["size"]]
                data = data[part["size"] :]
                on_log(
                    f"PUT part {i}/{total_parts} ({len(chunk):,} bytes) → S3"
                )
                put_resp = client.put(
                    part["url"],
                    content=chunk,
                    headers={"Content-Type": ctype},
                )
                put_resp.raise_for_status()
                etag = (
                    put_resp.headers.get("etag")
                    or put_resp.headers.get("ETag")
                    or ""
                ).strip().strip('"')
                completed.append({"partNumber": part["partNumber"], "etag": etag})

                sent += len(chunk)
                pct = sent / size * 100.0 if size else 100.0
                if pct - last_reported >= 1.0 or pct >= 100.0:
                    last_reported = pct
                    on_progress(
                        min(100.0, pct),
                        f"part {i}/{total_parts} ({sent:,}/{size:,} bytes)",
                    )

            on_progress(100.0, f"{size:,} bytes uploaded")

            complete_body = {
                "mode": "multipart",
                "uploadId": upload_id,
                "s3UploadId": s3_upload_id,
                "key": key,
                "filename": filename,
                "size": size,
                "contentType": ctype,
                "parts": completed,
                "ttl": ttl,
            }
        else:
            raise RuntimeError(f"Unknown upload mode: {mode!r}")

        # ── 3. complete ────────────────────────────────────────────────────
        on_log("POST /api/upload/complete")
        comp_resp = client.post(
            "/api/upload/complete", json=complete_body, headers=headers
        )
        comp_resp.raise_for_status()
        comp = comp_resp.json()

    return UploadResult(
        share_token=comp["shareToken"],
        share_url=comp.get("fullUrl") or f"{cfg.app_url}/d/{comp['shareToken']}",
        expires_at=comp["expiresAt"],
    )