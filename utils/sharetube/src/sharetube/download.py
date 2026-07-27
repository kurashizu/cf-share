"""
yt-dlp wrapper.

Streams the raw source video to a tempfile. Reports progress via a
callback so the Textual UI can update a ProgressBar. Stderr is filtered
to capture only the meaningful events we want to surface in the log
panel — yt-dlp is otherwise extremely chatty.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

from .config import Config

# yt-dlp `--progress-template` placeholders. We extract the fields
# in Python so we can show human-readable sizes (KB/MB/GB) and omit
# fields that are NA.
_PROGRESS_TEMPLATE = (
    "download: %(progress._percent_str)s "
    "speed=%(speed)s eta=%(eta)s "
    "of=%(total_bytes)s"
)


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


# Lines we want to keep in the TUI log. Anything else from yt-dlp is
# noise (network retries, format resolution, etc.).
_KEEP_RE = re.compile(
    r"^(?:\[(?:youtube|generic)\]|Destination:|\[Merger\]|\[ExtractAudio\]|"
    r"ERROR: |WARNING: |\[error\])"
)


@dataclass
class DownloadResult:
    path: Path
    title: str


def _run_once(
    url: str,
    outdir: Path,
    cfg: Config,
    extra_args: list[str],
    on_progress: Callable[[float, str], None],
    on_log: Callable[[str], None],
) -> DownloadResult:
    """Single yt-dlp invocation. Raises on failure."""
    out_template = str(outdir / "%(title).150B-[%(id)s].%(ext)s")

    # Build sort spec from the user's resolution preference. yt-dlp's
    # `res:<N>` sort key is a ceiling: `res:1080` allows ≤1080p. We
    # pass it before `ext` so a 1080p h264 stream wins over a 360p
    # progressive mp4.
    if cfg.max_resolution == "best":
        sort_res = "res"
    else:
        # Strip trailing 'p' for yt-dlp.
        n = cfg.max_resolution.rstrip("p")
        sort_res = f"res:{n}"

    cmd = [
        "yt-dlp",
        "--newline",
        "--no-part",  # avoid leaving .part files on interrupt
        "-o", out_template,
        # Sort priority: prefer h264 (smallest files at the same res
        # and broadest playback compatibility), then vp9, then hevc,
        # then m4a audio, then resolution ceiling, then mp4 container.
        # All three video codecs are hardware-decodable on modern
        # VAAPI (Intel/AMD/NVIDIA), and ffmpeg's `-hwaccel vaapi`
        # transparently falls back to native decode when a codec
        # lacks a VAAPI path on the current driver.
        "-S", f"vcodec:h264,vcodec:vp9,vcodec:hevc,{sort_res}",
        # Hard format filter. We accept h264, vp9 and hevc video
        # streams because the GPU can decode all of them, and
        # transcode.py will re-encode to h264_vaapi on the GPU
        # regardless. The primary branches prefer m4a audio; later
        # branches widen the audio format. Progressive `b*` formats
        # stay in the fallback so YouTube SABR / PO Token failures
        # still yield a usable 360p source rather than no source.
        "-f",
        # bv* = video-only formats (forces adaptive merge, avoids
        # low-res progressive fallback like format 18 on YouTube).
        "(bv*[vcodec^=avc1]+ba)/"
        "(bv*[vcodec=vp9]+ba)/"
        "(bv*[vcodec=hevc]+ba)/"
        "b[vcodec^=avc1][ext=mp4]/"
        "b[vcodec=h264]/b",
        "--merge-output-format", "mp4",
        "--progress-template", _PROGRESS_TEMPLATE,
        *extra_args,
        url,
    ]

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )

    # Drain stderr on a background thread so it can never deadlock the
    # stdout reader. We keep the last ~200 lines to surface yt-dlp's
    # actual error if the process exits non-zero.
    import threading
    stderr_lines: list[str] = []
    stderr_done = threading.Event()

    def _drain_stderr() -> None:
        assert proc.stderr is not None
        for ln in proc.stderr:
            stripped = ln.rstrip()
            stderr_lines.append(stripped)
            if len(stderr_lines) > 200:
                # Keep only the tail.
                del stderr_lines[: len(stderr_lines) - 200]
            # Surface real-time ERROR / WARNING to the TUI log so the
            # user sees them as they happen, not only after the process
            # has exited.
            if _KEEP_RE.match(stripped):
                try:
                    on_log(stripped)
                except Exception:
                    # on_log is invoked from the UI thread; never let a
                    # logging failure kill the stderr drainer.
                    pass
        stderr_done.set()

    t = threading.Thread(target=_drain_stderr, name="ytdlp-stderr", daemon=True)
    t.start()

    final_path: Optional[Path] = None
    # `progress._percent_str` is e.g. " 42.3%". When the format is
    # progressive (single-format download) yt-dlp prints the progress
    # line with leading whitespace and NO "download:" prefix; when it's
    # adaptive (multi-format, e.g. 137+140) yt-dlp prepends "download:".
    # Match either case by anchoring on the first percent value.
    pct_re = re.compile(r"^\s*(?:download:\s*)?([\d.]+)%")
    speed_re = re.compile(r"speed=([^\s]+)")
    eta_re = re.compile(r"eta=([^\s]+)")
    of_re = re.compile(r"of=(\S+)")
    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.rstrip()
        if not line:
            continue
        m = pct_re.match(line)
        if m:
            try:
                pct = float(m.group(1))
            except ValueError:
                continue
            # Build a clean meta string from the template fields.
            sm = speed_re.search(line)
            em = eta_re.search(line)
            om = of_re.search(line)
            speed = sm.group(1) if sm and sm.group(1) != "NA" else ""
            eta = em.group(1) if em and em.group(1) != "NA" else ""
            try:
                size = _fmt_bytes(int(om.group(1))) if om and om.group(1) != "NA" else ""
            except (ValueError, TypeError):
                size = ""
            parts = [p for p in [speed, eta, size] if p]
            meta = " ".join(parts)
            on_progress(min(100.0, max(0.0, pct)), meta)
            continue
        if _KEEP_RE.match(line):
            on_log(line)
        # Detect the final "Destination:" / merger line to capture the path.
        if line.startswith("[Merger] Merging formats into ") or line.startswith(
            "Destination:"
        ):
            try:
                fname = line.rsplit('"', 2)[-2]
                final_path = outdir / fname
            except IndexError:
                pass

    rc = proc.wait(timeout=3600)  # 1h upper bound; admin / large videos
    stderr_done.wait(timeout=5)
    if rc != 0:
        tail = "\n".join(stderr_lines[-30:]) if stderr_lines else "(no stderr)"
        raise RuntimeError(
            f"yt-dlp exited with code {rc}\n--- yt-dlp stderr (tail) ---\n{tail}"
        )
    if final_path is None or not final_path.exists():
        # Fall back: glob the outdir for the newest file.
        candidates = sorted(outdir.iterdir(), key=lambda p: p.stat().st_mtime)
        if not candidates:
            raise RuntimeError("yt-dlp produced no output file")
        final_path = candidates[-1]

    # Best-effort title fetch via yt-dlp --print.
    title = final_path.stem
    try:
        title_proc = subprocess.run(
            ["yt-dlp", "--print", "%(title)s", "--no-download", url],
            capture_output=True, text=True, check=True,
        )
        title = title_proc.stdout.strip() or title
    except Exception:
        pass

    return DownloadResult(path=final_path, title=title)


def download(
    url: str,
    outdir: Path,
    cfg: Config,
    on_progress: Callable[[float, str], None],
    on_log: Callable[[str], None],
) -> DownloadResult:
    """Download `url` into `outdir`, call on_progress(0..100, line).

    YouTube frequently forces SABR streaming on some clients/IPs, which
    causes the first client attempt to fail with "Some web_safari client
    https formats have been skipped as they are missing a URL". We try
    the default client set first; on failure we retry with an explicit
    list of fallback clients before giving up.
    """
    ytdlp_bin = shutil.which("yt-dlp") or "yt-dlp"
    try:
        ver = subprocess.run(
            [ytdlp_bin, "--version"], capture_output=True, text=True, timeout=10
        ).stdout.strip()
    except Exception as e:  # noqa: BLE001
        ver = f"unknown ({e})"
    on_log(f"yt-dlp: {ytdlp_bin} ({ver})")

    outdir.mkdir(parents=True, exist_ok=True)

    # User-overridable raw args. Useful for unlisted cookies file,
    # proxy, custom PO Token provider, etc.
    user_args = os.environ.get("CF_SHARE_YTDLP_ARGS", "").split()

    # Wipe any stale output files so the final_path glob on retry
    # doesn't pick up a previous attempt.
    for p in outdir.iterdir():
        try:
            p.unlink()
        except Exception:
            pass

    attempts: list[tuple[str, list[str]]] = [
        (
            "default",
            user_args,
        ),
        (
            "tv,web,ios,android_vr",
            [
                "--extractor-args",
                "youtube:player_client=tv,web,ios,android_vr",
                *user_args,
            ],
        ),
        (
            "mweb,web_creator",
            [
                "--extractor-args",
                "youtube:player_client=mweb,web_creator",
                *user_args,
            ],
        ),
    ]

    last_err: Optional[Exception] = None
    for label, extra in attempts:
        on_log(f"[dl] attempt: client_set={label}")
        try:
            return _run_once(url, outdir, cfg, extra, on_progress, on_log)
        except Exception as e:  # noqa: BLE001
            last_err = e
            on_log(
                f"[dl] attempt {label!r} failed: {type(e).__name__}: "
                f"{str(e).splitlines()[0] if str(e) else ''}"
            )
            # Wipe partial files between retries.
            for p in outdir.iterdir():
                try:
                    p.unlink()
                except Exception:
                    pass
            continue

    assert last_err is not None
    raise last_err