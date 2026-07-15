# Ad-hoc test scripts

These are manual end-to-end test scripts for the Worker API at
`https://share.022025.xyz`. They are not part of the build — they're
for poking the deployment from the terminal when manual verification
is needed.

## Prerequisites

- `python3` (3.10+)
- The 5.5GB test file at `~/Downloads/sql-finetune-finetuned-gguf-1.0.0.tar`
  (for `test_resume_e2e.py` only)

## Scripts

### `test_resume.py`
Synthetic 3-part multipart upload (≈100MB total, in-memory) to verify
the `/api/upload/init` → partial `/api/upload/resume` → complete →
download happy path. Runs in ~30s.

```bash
python3 scripts/test_resume.py
```

### `test_resume_edges.py`
Edge cases for `/api/upload/resume`: bogus s3UploadId, missing fields,
sub-multipart sizes, junk `uploadedPartNumbers`, rate limiting. Runs
in ~30s.

```bash
python3 scripts/test_resume_edges.py
```

### `test_resume_e2e.py`
End-to-end resume test using the real 5.5GB test file.

Two-phase:
  - **Phase 1**: init a multipart upload, PUT the first 30 parts,
    then exit (simulating a crash). Saves progress to
    `/tmp/cf-share-test/resume_e2e_state.json`.
  - **Phase 2**: re-run the script — it loads the saved state, calls
    `/api/upload/resume` with the completed part numbers, PUTs the
    remaining 84 parts, completes the upload, and verifies the
    downloaded bytes match the local file via MD5.

Total wall-clock: ~25 min (split across two runs).

```bash
# Phase 1 (upload + crash)
python3 scripts/test_resume_e2e.py

# Phase 2 (resume + finish + verify) — hours/days later, same machine
python3 scripts/test_resume_e2e.py
```

## Credentials

S3 admin endpoints (`/api/admin/...`) need HTTP Basic auth with the
S3 access key. These scripts don't use them.
