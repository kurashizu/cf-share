#!/usr/bin/env python3
"""Admin-upload test — verifies the HTTP Basic auth bypass on /api/upload/init.

Asserts:
  1. With auth: 6 GB request is accepted (above the 5 GB anon cap).
  2. With auth: response is multipart (large-file path).
  3. Without auth: 6 GB is rejected as over the 5 GB anon cap.
  4. Without auth: 4 GB is accepted.
  5. With auth: 35 rapid-fire /init calls all return 200 (no per-IP rate limit).
  6. /api/admin/audit shows a recent init row with detail.via == "admin".

Does NOT actually PUT data to S3 — only verifies the init endpoint contract
plus the audit log.
"""
from __future__ import annotations

import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

BASE = os.environ.get("CF_SHARE_BASE", "https://share.022025.xyz")
ADMIN_USER = os.environ.get("CF_SHARE_ADMIN_USER", "krsz")
ADMIN_PASS = os.environ.get("CF_SHARE_ADMIN_PASS", "cxk114514")

# 6 GB (above 5 GB anon cap) and 4 GB (under).
SIZE_BIG = 6 * 1024 * 1024 * 1024
SIZE_OK = 4 * 1024 * 1024 * 1024

# How many rapid-fire requests to send in the rate-limit bypass check.
RATE_BURST = 35


def basic_auth_header(user: str, password: str) -> str:
    token = base64.b64encode(f"{user}:{password}".encode()).decode()
    return f"Basic {token}"


def request(
    url: str,
    *,
    method: str = "GET",
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
    auth: tuple[str, str] | None = None,
) -> tuple[int, dict[str, str], bytes]:
    h = {"User-Agent": UA}
    if headers:
        h.update(headers)
    if auth is not None:
        h["Authorization"] = basic_auth_header(*auth)
    r = urllib.request.Request(url, data=body, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def init(size: int, *, auth: tuple[str, str] | None) -> tuple[int, dict]:
    body = json.dumps(
        {
            "size": size,
            "filename": "admin-probe.bin",
            "contentType": "application/octet-stream",
            "ttl": 3600,
        }
    ).encode()
    status, _, data = request(
        f"{BASE}/api/upload/init",
        method="POST",
        body=body,
        headers={"Content-Type": "application/json"},
        auth=auth,
    )
    try:
        payload = json.loads(data)
    except Exception:
        payload = {"_raw": data[:300].decode("utf-8", errors="replace")}
    return status, payload


def fetch_recent_audit(limit: int = 50) -> list[dict]:
    status, _, data = request(
        f"{BASE}/api/admin/audit",
        auth=(ADMIN_USER, ADMIN_PASS),
    )
    if status != 200:
        raise SystemExit(f"audit fetch failed {status}: {data[:200]!r}")
    body = json.loads(data)
    return body.get("entries", body if isinstance(body, list) else [])


def main() -> int:
    print(f"Base URL: {BASE}")
    print(f"Anonymous cap: 5 GB; admin cap: 100 GB")

    failures: list[str] = []

    print("\n=== 1. With auth, size=6 GB (above anon cap) → expect 200 ===")
    status, payload = init(SIZE_BIG, auth=(ADMIN_USER, ADMIN_PASS))
    print(f"  status={status}, mode={payload.get('mode')}, parts={len(payload.get('parts', []))}")
    if status != 200:
        failures.append(f"admin 6GB: expected 200, got {status}: {payload}")
    elif payload.get("mode") != "multipart":
        failures.append(f"admin 6GB: expected mode=multipart, got {payload.get('mode')}")

    print("\n=== 2. Without auth, size=6 GB → expect 400 (over 5 GB cap) ===")
    status, payload = init(SIZE_BIG, auth=None)
    print(f"  status={status}, error={payload.get('error')}")
    if status != 400:
        failures.append(f"anon 6GB: expected 400, got {status}: {payload}")
    elif "5368709120" not in (payload.get("error") or ""):
        failures.append(f"anon 6GB: expected error mentioning 5368709120, got {payload.get('error')}")

    print("\n=== 3. Without auth, size=4 GB → expect 200 ===")
    status, payload = init(SIZE_OK, auth=None)
    print(f"  status={status}, mode={payload.get('mode')}")
    if status != 200:
        failures.append(f"anon 4GB: expected 200, got {status}: {payload}")
    if payload.get("mode") != "multipart":
        failures.append(f"anon 4GB: expected mode=multipart, got {payload.get('mode')}")

    print(f"\n=== 4. Burst {RATE_BURST} admin /init requests → expect zero rate-limited ===")
    t0 = time.time()
    rejected: list[int] = []
    successes = 0
    for i in range(RATE_BURST):
        status, payload = init(SIZE_OK, auth=(ADMIN_USER, ADMIN_PASS))
        if status == 429:
            rejected.append(i)
        elif status == 200:
            successes += 1
    dt = time.time() - t0
    print(f"  {RATE_BURST} requests in {dt:.2f}s — {successes} ok, {len(rejected)} rate-limited")
    if rejected:
        failures.append(
            f"admin rate-limit bypass failed: requests {rejected} hit 429"
        )

    print("\n=== 5. Audit log carries via=admin ===")
    # Send a fresh admin-tagged init so we know which row to look for.
    stamp_filename = f"audit-probe-{int(time.time() * 1000)}.bin"
    body = json.dumps(
        {
            "size": 1024,
            "filename": stamp_filename,
            "contentType": "application/octet-stream",
            "ttl": 3600,
        }
    ).encode()
    status, _, data = request(
        f"{BASE}/api/upload/init",
        method="POST",
        body=body,
        headers={"Content-Type": "application/json"},
        auth=(ADMIN_USER, ADMIN_PASS),
    )
    if status != 200:
        failures.append(f"audit-stamp init failed: {status} {data[:200]!r}")

    time.sleep(2)  # give worker a moment to flush audit rows
    try:
        entries = fetch_recent_audit(50)
    except Exception as e:
        failures.append(f"audit fetch error: {e}")
        entries = []

    def detail_of(e: dict) -> dict:
        # The /api/admin/audit endpoint returns detail_json as a string. Parse it.
        d = e.get("detail")
        if isinstance(d, dict):
            return d
        raw = e.get("detail_json")
        if isinstance(raw, str):
            try:
                return json.loads(raw)
            except Exception:
                return {}
        return {}

    print(f"  fetched {len(entries)} recent audit entries")
    matching = [
        e for e in entries
        if e.get("action") == "init"
        and detail_of(e).get("via") == "admin"
        and detail_of(e).get("filename") == stamp_filename
    ]
    print(f"  init rows matching our probe (via=admin, filename={stamp_filename}): {len(matching)}")
    if not matching:
        failures.append(
            f"no init audit row with via=admin found for our {stamp_filename} probe — "
            "admin bypass may not be audited"
        )

    print("\n=== result ===")
    if failures:
        print(f"FAILED ({len(failures)})")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
