#!/usr/bin/env python3
"""End-to-end test of /api/upload/resume against the live Worker."""
import http.client
import json
import sys
import urllib.request
import urllib.error
from urllib.parse import urlparse

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
BASE_HOST = "share.022025.xyz"
BASE = f"https://{BASE_HOST}"
PART_SIZE = 50 * 1024 * 1024
FILE_SIZE = PART_SIZE * 2 + 1024
FILENAME = "resume-test.bin"
CONTENT_TYPE = "application/octet-stream"


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


def step(msg):
    print(f"\n=== {msg} ===")


def fail(msg):
    print(f"FAIL: {msg}")
    sys.exit(1)


def put_part(url, blob):
    status, headers, data = req(
        url, method="PUT", body=blob,
        headers={"Content-Type": CONTENT_TYPE},
    )
    if status != 200:
        return status, None, data
    raw = (
        headers.get("ETag")
        or headers.get("etag")
        or headers.get("Etag")
        or ""
    )
    etag = raw.strip().strip('"').strip("'")
    return status, etag or None, data


def get_with_redirect_manual(path, headers=None):
    """GET but don't auto-follow redirects."""
    conn = http.client.HTTPSConnection(BASE_HOST)
    h = {"User-Agent": UA, "Host": BASE_HOST}
    if headers:
        h.update(headers)
    conn.request("GET", path, headers=h)
    r = conn.getresponse()
    body = r.read()
    out = (r.status, dict(r.getheaders()), body)
    r.close()
    conn.close()
    return out


def s3_range_get(s3_url, offset, length):
    p = urlparse(s3_url)
    conn = http.client.HTTPSConnection(p.hostname, p.port or 443)
    full = p.path + ("?" + p.query if p.query else "")
    conn.request(
        "GET", full,
        headers={
            "Host": p.hostname,
            "Range": f"bytes={offset}-{offset + length - 1}",
        },
    )
    r = conn.getresponse()
    data = r.read()
    status = r.status
    r.close()
    conn.close()
    return status, data


def main():
    step("1. init multipart upload")
    body = json.dumps({
        "filename": FILENAME,
        "size": FILE_SIZE,
        "contentType": CONTENT_TYPE,
        "ttl": 300,
    }).encode()
    status, _, data = req(
        f"{BASE}/api/upload/init", method="POST", body=body,
        headers={"Content-Type": "application/json"},
    )
    if status != 200:
        fail(f"init {status}: {data[:300]}")
    init = json.loads(data)
    if init.get("mode") != "multipart":
        fail(f"expected multipart, got {init.get('mode')}")
    print(f"  s3UploadId={init['s3UploadId'][:40]}...")
    print(f"  total parts: {len(init['parts'])}")
    assert len(init["parts"]) == 3, f"want 3 parts, got {len(init['parts'])}"

    step("2. PUT parts 1+2 with ETag capture")
    etags = {}
    blobs = {1: b"A" * PART_SIZE, 2: b"B" * PART_SIZE}
    for part_no in (1, 2):
        status, etag, data = put_part(init["parts"][part_no - 1]["url"], blobs[part_no])
        if status != 200:
            fail(f"part {part_no} PUT {status}: {data[:200]}")
        if not etag:
            fail(f"part {part_no}: empty ETag")
        etags[part_no] = etag
        print(f"  part {part_no}: OK ETag={etag[:16]}...")

    step("3. /api/upload/resume with uploadedPartNumbers=[1,2]")
    body = json.dumps({
        "s3UploadId": init["s3UploadId"],
        "key": init["key"],
        "size": FILE_SIZE,
        "uploadedPartNumbers": [1, 2],
    }).encode()
    status, _, data = req(
        f"{BASE}/api/upload/resume", method="POST", body=body,
        headers={"Content-Type": "application/json"},
    )
    if status != 200:
        fail(f"resume {status}: {data[:500]}")
    resume = json.loads(data)
    print(f"  mode={resume.get('mode')}")
    print(f"  parts returned (presigned): {[p['partNumber'] for p in resume['parts']]}")
    if len(resume["parts"]) != 1:
        fail(f"want 1 missing part, got {len(resume['parts'])}")
    if resume["parts"][0]["partNumber"] != 3:
        fail(f"want part 3, got {resume['parts'][0]['partNumber']}")
    if resume["key"] != init["key"]:
        fail("key mismatch")
    if resume["s3UploadId"] != init["s3UploadId"]:
        fail("s3UploadId mismatch")
    print("  ✓ exactly 1 part (part 3) needs uploading")
    print("  ✓ key + s3UploadId preserved")

    step("4. PUT part 3 with the resume-provided URL")
    blob3 = b"C" * 1024
    status, etag3, data = put_part(resume["parts"][0]["url"], blob3)
    if status != 200:
        fail(f"part 3 PUT {status}: {data[:200]}")
    etags[3] = etag3
    print(f"  part 3: OK ETag={etag3[:16]}...")

    step("5. /api/upload/complete — finalize multipart")
    body = json.dumps({
        "mode": "multipart",
        "uploadId": init["uploadId"],
        "s3UploadId": init["s3UploadId"],
        "key": init["key"],
        "filename": FILENAME,
        "size": FILE_SIZE,
        "contentType": CONTENT_TYPE,
        "ttl": 300,
        "parts": [
            {"partNumber": 1, "etag": etags[1]},
            {"partNumber": 2, "etag": etags[2]},
            {"partNumber": 3, "etag": etags[3]},
        ],
    }).encode()
    status, _, data = req(
        f"{BASE}/api/upload/complete", method="POST", body=body,
        headers={"Content-Type": "application/json"},
    )
    if status != 200:
        fail(f"complete {status}: {data[:500]}")
    complete = json.loads(data)
    token = complete["shareToken"]
    full_url = complete["fullUrl"]
    print(f"  shareToken={token}")
    print(f"  fullUrl={full_url}")

    step("6. /api/download/{token} → 302 → presigned URL → range GET")
    status, headers, _ = get_with_redirect_manual(f"/api/download/{token}")
    if status != 302:
        fail(f"expected 302, got {status}")
    s3_url = headers.get("Location", "")
    if not s3_url:
        fail("no Location header in 302")
    print(f"  presigned URL: {s3_url[:80]}...")

    cases = [
            (0, 1, b"A"),
            (PART_SIZE, 1, b"B"),
            (PART_SIZE * 2, 1, b"C"),
            (PART_SIZE - 1, 1, b"A"),
            (PART_SIZE * 2 - 1, 1, b"B"),
            (PART_SIZE + 100, 5, b"BBBBB"),
            (PART_SIZE * 2 + 500, 10, b"CCCCCCCCCC"),
            (PART_SIZE * 2 + 1014, 1, b"C"),  # last byte of file
    ]
    for offset, length, expected in cases:
            status, data = s3_range_get(s3_url, offset, length)
            if status not in (200, 206):
                fail(f"S3 GET {status} for offset {offset}")
            if data != expected:
                fail(f"offset {offset}: expected {expected!r}, got {data!r}")
            print(f"  byte {offset}..{offset + length - 1}: OK ({expected!r})")

    print(f"\nALL CHECKS PASSED — share at {full_url}")


if __name__ == "__main__":
    main()