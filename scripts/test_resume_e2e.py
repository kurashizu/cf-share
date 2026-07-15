#!/usr/bin/env python3
"""End-to-end resume test using the real 5.5GB tar file.

Flow:
  1. Init multipart upload for the file
  2. PUT parts 1..30 (about 1.5GB), then SIMULATE CRASH (kill process)
  3. In a fresh process, "resume" — call /api/upload/resume with
     uploadedPartNumbers=[1..30]
  4. PUT the remaining 84 parts
  5. /api/upload/complete
  6. Download a chunk and compare bytes to original
"""
import http.client
import json
import os
import signal
import subprocess
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path
from urllib.parse import urlparse

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
BASE_HOST = "share.022025.xyz"
BASE = f"https://{BASE_HOST}"
PART_SIZE = 50 * 1024 * 1024
FILE = Path.home() / "Downloads/sql-finetune-finetuned-gguf-1.0.0.tar"
STATE_FILE = Path("/tmp/cf-share-test/resume_e2e_state.json")
RESUME_AT_PART = 30  # crash after part 30


def req(url, *, method="GET", body=None, headers=None):
    h = {"User-Agent": UA}
    if headers:
        h.update(headers)
    r = urllib.request.Request(url, data=body, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def put_part(url, blob):
    status, headers, data = req(
        url, method="PUT", body=blob,
        headers={"Content-Type": "application/octet-stream"},
    )
    if status != 200:
        return status, None
    raw = headers.get("ETag") or headers.get("etag") or headers.get("Etag") or ""
    return status, raw.strip().strip('"').strip("'") or None


def save_state(d):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(d, indent=2))


def load_state():
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except Exception:
            pass
    return None


def main():
    file_size = FILE.stat().st_size
    print(f"File: {FILE} ({file_size:,} bytes = {file_size/1024/1024/1024:.2f} GB)")
    total_parts = (file_size + PART_SIZE - 1) // PART_SIZE
    print(f"Total parts: {total_parts}")

    state = load_state()
    if state is None:
        print("\n=== PHASE 1: init + upload first 30 parts then CRASH ===")
        body = json.dumps({
            "filename": FILE.name,
            "size": file_size,
            "contentType": "application/octet-stream",
            "ttl": 3600,
        }).encode()
        status, _, data = req(
            f"{BASE}/api/upload/init", method="POST", body=body,
            headers={"Content-Type": "application/json"},
        )
        if status != 200:
            print(f"FAIL init {status}: {data[:300]}")
            sys.exit(1)
        init = json.loads(data)
        print(f"  s3UploadId={init['s3UploadId'][:40]}...")
        print(f"  total parts: {len(init['parts'])}")

        etags = {}
        with open(FILE, "rb") as f:
            for pn in range(1, RESUME_AT_PART + 1):
                offset = (pn - 1) * PART_SIZE
                chunk = min(PART_SIZE, file_size - offset)
                f.seek(offset)
                blob = f.read(chunk)
                url = init["parts"][pn - 1]["url"]
                t0 = time.time()
                status, etag = put_part(url, blob)
                dt = time.time() - t0
                if status != 200:
                    print(f"FAIL part {pn} PUT {status}")
                    sys.exit(1)
                etags[pn] = etag
                print(f"  part {pn:3d}: OK ({dt:.1f}s) ETag={etag[:12]}")

        # Simulate crash — exit without calling complete
        save_state({
            "s3UploadId": init["s3UploadId"],
            "key": init["key"],
            "uploadId": init["uploadId"],
            "fileSize": file_size,
            "filename": FILE.name,
            "completedParts": [
                {"partNumber": pn, "etag": etags[pn]} for pn in etags
            ],
        })
        print(f"\n  *** simulated CRASH — state saved to {STATE_FILE} ***")
        print(f"  *** re-run the script to resume from part {RESUME_AT_PART + 1} ***")
        return

    print("\n=== PHASE 2: resume from saved state ===")
    print(f"  loaded state: {len(state['completedParts'])} parts already uploaded")

    body = json.dumps({
        "s3UploadId": state["s3UploadId"],
        "key": state["key"],
        "size": state["fileSize"],
        "uploadedPartNumbers": [p["partNumber"] for p in state["completedParts"]],
    }).encode()
    t0 = time.time()
    status, _, data = req(
        f"{BASE}/api/upload/resume", method="POST", body=body,
        headers={"Content-Type": "application/json"},
    )
    if status != 200:
        print(f"FAIL resume {status}: {data[:500]}")
        sys.exit(1)
    resume = json.loads(data)
    print(f"  resume took {time.time()-t0:.1f}s")
    print(f"  presigned URLs returned for parts: {[p['partNumber'] for p in resume['parts'][:5]]}... ({len(resume['parts'])} total)")

    expected_remaining = total_parts - len(state["completedParts"])
    if len(resume["parts"]) != expected_remaining:
        print(f"FAIL expected {expected_remaining} remaining parts, got {len(resume['parts'])}")
        sys.exit(1)
    print(f"  ✓ exactly {expected_remaining} remaining parts")

    print("\n=== PHASE 3: PUT remaining parts ===")
    completed = {p["partNumber"]: p["etag"] for p in state["completedParts"]}
    presign_by_pn = {p["partNumber"]: p for p in resume["parts"]}
    t0 = time.time()
    with open(FILE, "rb") as f:
        for i, pn in enumerate(sorted(presign_by_pn.keys())):
            offset = (pn - 1) * PART_SIZE
            chunk = min(PART_SIZE, file_size - offset)
            f.seek(offset)
            blob = f.read(chunk)
            url = presign_by_pn[pn]["url"]
            part_t0 = time.time()
            status, etag = put_part(url, blob)
            dt = time.time() - part_t0
            if status != 200:
                print(f"FAIL part {pn} PUT {status}")
                sys.exit(1)
            completed[pn] = etag
            elapsed = time.time() - t0
            speed_mb = (chunk / dt) / 1024 / 1024
            avg_speed = ((pn - state['completedParts'][-1]['partNumber']) * PART_SIZE / elapsed) / 1024 / 1024
            print(f"  part {pn:3d}: OK ({dt:.1f}s, {speed_mb:.1f} MB/s) | avg {avg_speed:.1f} MB/s | ETA {((total_parts - pn) * PART_SIZE) / (avg_speed * 1024 * 1024):.0f}s")

    print(f"\n  all {total_parts} parts uploaded in {time.time()-t0:.1f}s")

    print("\n=== PHASE 4: complete ===")
    body = json.dumps({
        "mode": "multipart",
        "uploadId": state["uploadId"],
        "s3UploadId": state["s3UploadId"],
        "key": state["key"],
        "filename": state["filename"],
        "size": state["fileSize"],
        "contentType": "application/octet-stream",
        "ttl": 3600,
        "parts": [
            {"partNumber": pn, "etag": completed[pn]}
            for pn in sorted(completed.keys())
        ],
    }).encode()
    status, _, data = req(
        f"{BASE}/api/upload/complete", method="POST", body=body,
        headers={"Content-Type": "application/json"},
    )
    if status != 200:
        print(f"FAIL complete {status}: {data[:500]}")
        sys.exit(1)
    complete = json.loads(data)
    token = complete["shareToken"]
    print(f"  shareToken={token}")
    print(f"  fullUrl={complete['fullUrl']}")

    print("\n=== PHASE 5: verify content (download 3 byte ranges) ===")
    # /api/download/{token} -> 302 -> presigned URL -> range GET
    conn = http.client.HTTPSConnection(BASE_HOST)
    conn.request("GET", f"/api/download/{token}", headers={"User-Agent": UA, "Host": BASE_HOST})
    r = conn.getresponse()
    if r.status != 302:
        print(f"FAIL 302 expected, got {r.status}: {r.read()[:200]}")
        sys.exit(1)
    s3_url = r.getheader("Location")
    r.read(); conn.close()
    print(f"  presigned: {s3_url[:80]}...")

    # Read expected bytes from local file
    def check_range(offset, length):
        # Expected from local file
        with open(FILE, "rb") as f:
            f.seek(offset)
            expected = f.read(length)
        # Fetch from S3
        p = urlparse(s3_url)
        conn = http.client.HTTPSConnection(p.hostname, p.port or 443)
        conn.request("GET", p.path + ("?" + p.query if p.query else ""),
                     headers={"Host": p.hostname, "Range": f"bytes={offset}-{offset+length-1}"})
        r = conn.getresponse()
        got = r.read()
        r.close(); conn.close()
        if r.status not in (200, 206):
            print(f"FAIL S3 GET {r.status} for offset {offset}")
            sys.exit(1)
        if got != expected:
            print(f"FAIL offset {offset}: local {expected[:16]!r}... vs S3 {got[:16]!r}...")
            sys.exit(1)
        print(f"  ✓ offset {offset}..{offset+length-1}: matches local file")

    # Check 3 ranges: start, middle, end
    check_range(0, 1024)
    check_range(file_size // 2, 1024)
    check_range(file_size - 1024, 1024)

    # Clean up state
    STATE_FILE.unlink()
    print(f"\n✓✓✓ ALL CHECKS PASSED — share at {complete['fullUrl']}")


if __name__ == "__main__":
    main()