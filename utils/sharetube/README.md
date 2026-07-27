# sharetube

TUI tool: paste a video URL, download via `yt-dlp`, transcode with
`ffmpeg` (VAAPI h264 + AAC @ 2 Mbps), upload to `share.krsz.in`.

## Requirements

- Python ≥ 3.11
- [`uv`](https://docs.astral.sh/uv/) (manages the venv + deps)
- `yt-dlp` and `ffmpeg` / `ffprobe` on `$PATH`
- A `/dev/dri/renderD128` device for hardware encode (auto-falls back to
  `libx264` software encode if missing)

## Install

```bash
cd utils/sharetube
uv sync
```

## Run

```bash
uv run sharetube
# or, admin mode (bypasses per-IP quotas):
CF_SHARE_ADMIN_USER=... CF_SHARE_ADMIN_PASS=... uv run sharetube --admin
```

Paste a URL, press Enter. Three progress bars track download → transcode
→ upload, and the bottom panel streams yt-dlp / ffmpeg / API events.

## Config

All knobs are environment variables; defaults are sensible for a single
user on a Linux box with an Intel/AMD GPU.

| Var | Default | Purpose |
|---|---|---|
| `CF_SHARE_BASE` | `https://share.krsz.in` | Override the upload host (sync with `cf-share/lib/config/app.ts → APP_URL`). |
| `CF_SHARE_ADMIN_USER` | — | Required only when `--admin` is set. |
| `CF_SHARE_ADMIN_PASS` | — | Required only when `--admin` is set. |

Output bitrate (video 2 Mbps, audio 128k AAC) and the VAAPI device
path are hardcoded in `src/sharetube/config.py`; edit if you need
something different. We deliberately do not read these from env so the
default path is one file to grep.

## Layout

```
src/sharetube/
├── __main__.py    CLI entry
├── app.py         Textual App (UI + pipeline orchestration)
├── config.py      Constants (mirrors cf-share/lib/config/app.ts)
├── download.py    yt-dlp subprocess + progress regex
├── transcode.py   ffmpeg VAAPI + libx264 fallback
└── upload.py      /api/upload/{init,complete} client
```

## Security notes

- No credentials are hardcoded anywhere. Admin mode reads from env at
  upload time.
- The tool never proxies file bytes through any local HTTP server; the
  Worker returns a presigned S3 URL and we PUT directly to S3, same as
  the browser flow.
- API responses are surfaced verbatim in the log so server-side errors
  are visible, but share URLs / tokens only — never secrets.