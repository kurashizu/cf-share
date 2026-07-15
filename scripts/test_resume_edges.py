#!/usr/bin/env python3
"""Edge-case tests for /api/upload/resume."""
import json
import sys
import urllib.request
import urllib.error

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
BASE = "https://share.022025.xyz"


def req(url, *, method="GET", body=None, headers=None):
    h = {"User-Agent": UA}
    if headers:
        h.update(headers)
    r = urllib.request.Request(url, data=body, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def step(msg):
    print(f"\n=== {msg} ===")


def check(cond, msg):
    if not cond:
        print(f"FAIL: {msg}")
        sys.exit(1)
    print(f"  ✓ {msg}")


def main():
    step("Edge 1: bogus s3UploadId returns 200 with presigned URLs (S3 will reject at PUT)")
    body = json.dumps({
        "s3UploadId": "totally-bogus-id",
        "key": "uploads/2026/07/15/nope.bin",
        "size": 1048577024,
        "uploadedPartNumbers": [],
    }).encode()
    status, _, data = req(
        f"{BASE}/api/upload/resume", method="POST", body=body,
        headers={"Content-Type": "application/json"},
    )
    check(status == 200, f"got 200 (was {status})")
    resume = json.loads(data)
    # All 21 parts presigned (since uploadedPartNumbers was empty)
    check(len(resume["parts"]) == 21, f"21 parts presigned (got {len(resume['parts'])})")

    step("Edge 2: missing fields → 400")
    body = json.dumps({}).encode()
    status, _, data = req(
        f"{BASE}/api/upload/resume", method="POST", body=body,
        headers={"Content-Type": "application/json"},
    )
    check(status == 400, f"got 400 (was {status})")

    step("Edge 3: size below multipart threshold → 400")
    body = json.dumps({
        "s3UploadId": "x",
        "key": "uploads/x/y.bin",
        "size": 1024,
        "uploadedPartNumbers": [],
    }).encode()
    status, _, data = req(
        f"{BASE}/api/upload/resume", method="POST", body=body,
        headers={"Content-Type": "application/json"},
    )
    check(status == 400, f"got 400 (was {status})")
    check(b"multipart" in data.lower(), "body mentions multipart")

    step("Edge 4: init then resume with empty uploadedPartNumbers returns ALL parts")
    body = json.dumps({
        "filename": "edge4.bin",
        "size": 100 * 1024 * 1024,
        "contentType": "application/octet-stream",
        "ttl": 300,
    }).encode()
    status, _, data = req(
        f"{BASE}/api/upload/init", method="POST", body=body,
        headers={"Content-Type": "application/json"},
    )
    check(status == 200, "init 200")
    init = json.loads(data)
    check(init["mode"] == "multipart", "multipart mode")
    check(len(init["parts"]) == 2, f"2 parts (got {len(init['parts'])})")

    body = json.dumps({
        "s3UploadId": init["s3UploadId"],
        "key": init["key"],
        "size": 100 * 1024 * 1024,
        "uploadedPartNumbers": [],
    }).encode()
    status, _, data = req(
        f"{BASE}/api/upload/resume", method="POST", body=body,
        headers={"Content-Type": "application/json"},
    )
    check(status == 200, "resume 200")
    resume = json.loads(data)
    check(len(resume["parts"]) == 2, f"all 2 parts presigned (got {len(resume['parts'])})")
    check([p["partNumber"] for p in resume["parts"]] == [1, 2], "parts [1,2]")

    step("Edge 5: resume with uploadedPartNumbers=[1] returns only part 2")
    body = json.dumps({
        "s3UploadId": init["s3UploadId"],
        "key": init["key"],
        "size": 100 * 1024 * 1024,
        "uploadedPartNumbers": [1],
    }).encode()
    status, _, data = req(
        f"{BASE}/api/upload/resume", method="POST", body=body,
        headers={"Content-Type": "application/json"},
    )
    check(status == 200, "resume 200")
    resume = json.loads(data)
    check(len(resume["parts"]) == 1, f"1 part (got {len(resume['parts'])})")
    check(resume["parts"][0]["partNumber"] == 2, "part 2")

    step("Edge 6: uploadedPartNumbers with junk values are filtered out")
    body = json.dumps({
        "s3UploadId": init["s3UploadId"],
        "key": init["key"],
        "size": 100 * 1024 * 1024,
        "uploadedPartNumbers": [1, "two", -5, 999999, 3.14, None],
    }).encode()
    status, _, data = req(
        f"{BASE}/api/upload/resume", method="POST", body=body,
        headers={"Content-Type": "application/json"},
    )
    check(status == 200, "resume 200 (junk ignored)")
    resume = json.loads(data)
    check(len(resume["parts"]) == 1, f"1 part left after filtering (got {len(resume['parts'])})")
    check(resume["parts"][0]["partNumber"] == 2, "part 2 still missing")

    step("Edge 7: rate-limit smoke check (informational)")
    # The CF rate limit binding may or may not fire for in-process test
    # bursts depending on edge routing. We just log what happens — actual
    # rate-limit correctness is a CF-side concern, not ours.
    body = json.dumps({
        "s3UploadId": init["s3UploadId"],
        "key": init["key"],
        "size": 100 * 1024 * 1024,
        "uploadedPartNumbers": [],
    }).encode()
    statuses = {}
    for _ in range(40):
        s, _, _ = req(
            f"{BASE}/api/upload/resume", method="POST", body=body,
            headers={"Content-Type": "application/json"},
        )
        statuses[s] = statuses.get(s, 0) + 1
    print(f"  (informational) 40-burst status counts: {statuses}")

    print("\nALL EDGE CASES PASSED")


if __name__ == "__main__":
    main()