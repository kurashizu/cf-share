"""
ffmpeg wrapper — full VAAPI h264 + AAC, 2 Mbps video.

Pipeline (always-on, no software fallback):

    ffmpeg -vaapi_device <dev>
           -hwaccel vaapi
           -hwaccel_output_format vaapi
           -i <input>
           -vf 'format=vaapi,scale_vaapi=...'
           -c:v h264_vaapi -rc_mode VBR -b:v 2M -maxrate 2.5M -bufsize 4M
           -c:a aac -b:a 128k
           -movflags +faststart
           -progress pipe:1 -nostats
           <output>

maxrate and bufsize are derived dynamically from video_bitrate (1.25×
and 2× respectively) so the user can set any bitrate in Settings.

We require the VAAPI device (e.g. /dev/dri/renderD128) to exist and be
readable; if it doesn't, this function raises immediately rather than
silently degrading to libx264. The transcode must stay on the GPU end
to end.

Progress is reported via ffmpeg's `-progress pipe:1` protocol. Stderr is
drained on a background thread so a noisy VAAPI init log can't deadlock
the stdout reader.
"""
from __future__ import annotations

import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .config import Config

_OUT_TIME_RE = re.compile(r"out_time_ms=(\d+)")
_SPEED_RE = re.compile(r"speed=\s*([\d.]+)x")


@dataclass
class TranscodeResult:
    path: Path


def probe_video(src: Path) -> str:
    """Run ffprobe and return a one-line human-readable spec string."""
    try:
        proc = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate,bit_rate",
                "-of", "json",
                str(src),
            ],
            capture_output=True, text=True, check=True, timeout=15,
        )
        import json
        data = json.loads(proc.stdout)
    except Exception:
        return src.name

    fmt = data.get("format", {})
    duration_s = float(fmt.get("duration", 0))
    total_size = int(fmt.get("size", 0))
    streams = data.get("streams", [])

    video = next((s for s in streams if s.get("codec_type") == "video"), {})
    audio = next((s for s in streams if s.get("codec_type") == "audio"), {})

    parts: list[str] = []
    # Resolution + codec
    w = video.get("width")
    h = video.get("height")
    vcodec = video.get("codec_name", "")
    if w and h:
        parts.append(f"{w}x{h}")
    if vcodec:
        parts.append(vcodec.upper())
    # Frame rate
    fps_str = video.get("r_frame_rate", "")
    if fps_str and "/" in fps_str:
        num, den = fps_str.split("/", 1)
        try:
            fps = int(num) / int(den)
            parts.append(f"{fps:.0f}fps")
        except (ValueError, ZeroDivisionError):
            pass
    elif fps_str:
        parts.append(f"{fps_str}fps")
    # Duration
    if duration_s > 0:
        m, s = divmod(int(duration_s), 60)
        h, m = divmod(m, 60)
        if h:
            parts.append(f"{h}h{m:02d}m{s:02d}s")
        else:
            parts.append(f"{m}m{s:02d}s")
    # Size
    if total_size > 0:
        if total_size >= 1024 * 1024 * 1024:
            parts.append(f"{total_size / 1024 / 1024 / 1024:.2f} GB")
        else:
            parts.append(f"{total_size / 1024 / 1024:.1f} MB")
    # Video bitrate
    vbr = video.get("bit_rate")
    if vbr:
        try:
            vbr_kbps = int(vbr) / 1000
            parts.append(f"{vbr_kbps:.0f}k")
        except (ValueError, TypeError):
            pass
    # Audio codec
    acodec = audio.get("codec_name", "")
    if acodec:
        parts.append(f"audio:{acodec.upper()}")

    return " ".join(parts) if parts else src.name


def _probe_duration(src: Path) -> float:
    """Read media duration via ffprobe."""
    proc = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(src),
        ],
        capture_output=True, text=True, check=True,
    )
    return float(proc.stdout.strip())


def probe_video_bitrate(src: Path) -> int | None:
    """Return the video stream bitrate in kbps, or None."""
    try:
        proc = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=bit_rate",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(src),
            ],
            capture_output=True, text=True, check=True, timeout=15,
        )
        val = proc.stdout.strip()
        if val and val != "N/A":
            return int(val) // 1000  # bps → kbps
    except Exception:
        pass
    # Fallback: compute from format size / duration.
    try:
        proc = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration,size",
                "-of", "json",
                str(src),
            ],
            capture_output=True, text=True, check=True, timeout=15,
        )
        import json
        data = json.loads(proc.stdout)
        dur = float(data["format"].get("duration", 0))
        size = int(data["format"].get("size", 0))
        if dur > 0 and size > 0:
            return int(size * 8 / dur / 1000)  # bps → kbps
    except Exception:
        pass
    return None


def probe_video_height(src: Path) -> int | None:
    """Return the source video height in pixels, or None."""
    try:
        proc = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=height",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(src),
            ],
            capture_output=True, text=True, check=True, timeout=15,
        )
        val = proc.stdout.strip()
        if val and val != "N/A":
            return int(val)
    except Exception:
        pass
    return None


def _parse_bitrate(s: str) -> int:
    """Parse an ffmpeg-style bitrate string (e.g. '2M', '1500k') to kbps."""
    s = s.strip()
    if s.lower().endswith("m"):
        return int(float(s[:-1]) * 1000)
    if s.lower().endswith("k"):
        return int(float(s[:-1]))
    return int(float(s) / 1000)


def _find_cjk_font() -> str | None:
    """Auto-detect a CJK-capable font on the system."""
    candidates = [
        "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/noto/NotoSans-Regular.ttf",
    ]
    for p in candidates:
        if Path(p).exists():
            return p
    return None


def _escape_drawtext(text: str) -> str:
    """Escape text for ffmpeg's drawtext filter.

    drawtext uses backslash-n for newlines, colon for key=value,
    and percent for template expansion. We must not double-escape
    the newline markers.
    """
    # Step 1: replace Python newlines with the two-char literal \n
    # that drawtext understands as a line break.
    text = text.replace(chr(10), chr(92) + "n")  # \n
    # Step 2: escape colons and percent signs (but NOT backslashes,
    # because the only backslashes in the string are the ones we
    # just inserted for newlines).
    text = text.replace(":", chr(92) + ":")
    text = text.replace("%", "%%")
    return text


def _format_watermark(cfg: Config, src: Path) -> tuple[str, str]:
    """Build watermark text. Returns (line1, line2)."""
    import json
    info: dict[str, str] = {}
    try:
        proc = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration,size:stream=codec_type,codec_name,width,height,bit_rate",
                "-of", "json",
                str(src),
            ],
            capture_output=True, text=True, check=True, timeout=15,
        )
        data = json.loads(proc.stdout)
        fmt = data.get("format", {})
        streams = data.get("streams", [])
        video = next((s for s in streams if s.get("codec_type") == "video"), {})
        dur = float(fmt.get("duration", 0))
        m, s = divmod(int(dur), 60)
        h, m = divmod(m, 60)
        info["duration"] = f"{h}h{m:02d}m{s:02d}s" if h else f"{m}m{s:02d}s"
        w = video.get("width", 0)
        h_px = video.get("height", 0)
        info["resolution"] = f"{w}x{h_px}" if w and h_px else ""
        info["codec"] = (video.get("codec_name") or "").upper()
        vbr = video.get("bit_rate")
        if vbr:
            info["bitrate"] = f"{int(vbr) // 1000}k"
        else:
            info["bitrate"] = ""
        info["title"] = src.stem.split("[")[0].strip() if "[" in src.stem else src.stem
    except Exception:
        pass
    line1 = cfg.watermark_line1
    try:
        line2 = cfg.watermark_line2.format(**info) if cfg.watermark_line2 else ""
    except KeyError:
        line2 = cfg.watermark_line2
    return line1, line2


def _build_cmd(src: Path, dst: Path, cfg: Config, source_bitrate_kbps: int | None = None, effective_resolution: str | None = None, title: str = "") -> list[str]:
    """Build the ffmpeg argv. Order matters: input → video filter →
    video codec → audio codec → muxer flags → output."""
    # `format=vaapi` ensures any non-VAAPI-decoded frame gets uploaded
    # to the GPU before encoding. When the user picked a fixed
    # output resolution we downscale on the GPU; when they picked
    # `source` we just upload and let the encoder honour the source
    # dimensions.
    #
    # We pass the target height as a literal — the `min(H,ih)`
    # expression we'd otherwise need is unsafe to forward through
    # `subprocess.Popen(shell=False)` because ffmpeg's filter
    # parser mis-treats the comma in the expression.
    out_res = effective_resolution or cfg.output_resolution
    # Determine if we need a software filter (drawtext for watermark).
    use_watermark = cfg.watermark_enabled and title
    font = (cfg.watermark_font or _find_cjk_font()) if use_watermark else None
    if use_watermark and not font:
        use_watermark = False

    # maxrate must be ≥ video_bitrate for VBR; use 1.25× to give the
    # encoder headroom above the target without exploding bandwidth.
    cfg_kbps = _parse_bitrate(cfg.video_bitrate)
    # Cap at source bitrate so we don't inflate the file.
    if source_bitrate_kbps and source_bitrate_kbps > 0:
        vbr_kbps = min(cfg_kbps, source_bitrate_kbps)
    else:
        vbr_kbps = cfg_kbps
    effective_bitrate = f"{vbr_kbps}k"
    maxrate_kbps = max(vbr_kbps, int(vbr_kbps * 1.25))
    maxrate_str = f"{maxrate_kbps}k"
    bufsize_str = f"{max(vbr_kbps * 2, 4000)}k"

    if use_watermark and font:
        # VAAPI filter chain (hwdownload→filter→hwupload) is broken on
        # many Intel/AMD drivers. Fall back to software encoding.
        line1, line2 = _format_watermark(cfg, src)
        fs = cfg.watermark_font_size
        vf_parts = []
        if line1:
            esc1 = _escape_drawtext(line1)
            vf_parts.append(
                f"drawtext=fontfile='{font}':text='{esc1}':"
                f"fontsize={fs}:fontcolor=white:"
                f"shadowx=2:shadowy=2:shadowcolor=black@0.6:"
                f"x=10:y=10:"
                f"box=1:boxcolor=black@0.4:boxborderw=6"
            )
        if line2:
            esc2 = _escape_drawtext(line2)
            vf_parts.append(
                f"drawtext=fontfile='{font}':text='{esc2}':"
                f"fontsize={fs}:fontcolor=white:"
                f"shadowx=2:shadowy=2:shadowcolor=black@0.6:"
                f"x=10:y=h-th-10:"
                f"box=1:boxcolor=black@0.4:boxborderw=6"
            )
        if out_res != "source":
            h = out_res.rstrip("p")
            vf_parts.append(f"scale=-2:{h}")
        vf = ",".join(vf_parts)
        return [
            "ffmpeg", "-hide_banner", "-y",
            "-i", str(src),
            "-vf", vf,
            "-c:v", "libx264", "-preset", cfg.encoder_preset,
            "-b:v", effective_bitrate,
            "-maxrate", maxrate_str, "-bufsize", bufsize_str,
            "-c:a", "aac", "-b:a", cfg.audio_bitrate,
            "-movflags", "+faststart",
            "-progress", "pipe:1", "-nostats",
            str(dst),
        ]

    # No watermark: use VAAPI hardware encoding.
    vf_parts = ["format=vaapi"]
    if out_res != "source":
        h = out_res.rstrip("p")
        vf_parts.append(f"scale_vaapi=-2:{h}:mode=fast")
    vf = ",".join(vf_parts)
    return [
        "ffmpeg",
        "-hide_banner", "-y",
        "-vaapi_device", cfg.vaapi_device,
        "-hwaccel", "vaapi",
        "-hwaccel_output_format", "vaapi",
        "-i", str(src),
        "-vf", vf,
        "-c:v", "h264_vaapi",
        "-rc_mode", "VBR",
        "-b:v", effective_bitrate,
        "-maxrate", maxrate_str,
        "-bufsize", bufsize_str,
        "-c:a", "aac",
        "-b:a", cfg.audio_bitrate,
        "-movflags", "+faststart",
        "-progress", "pipe:1",
        "-nostats",
        str(dst),
    ]


def transcode(
    src: Path,
    dst: Path,
    cfg: Config,
    on_progress: Callable[[float, str], None],
    on_log: Callable[[str], None],
    title: str = "",
) -> TranscodeResult:
    """Transcode `src` to `dst` using the full VAAPI pipeline.

    Raises RuntimeError if the VAAPI device is missing, ffmpeg exits
    non-zero, or no output file is produced. Never falls back to
    software encoding.
    """
    # Hard requirement: VAAPI must be available. Don't silently
    # downgrade to libx264.
    vaapi_dev = Path(cfg.vaapi_device)
    if not vaapi_dev.exists():
        raise RuntimeError(
            f"VAAPI device {vaapi_dev} not found. "
            f"sharetube requires a VAAPI-capable GPU on /dev/dri/renderD128 "
            f"(override via Config.vaapi_device). Set the device and re-run."
        )
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg not on PATH")
    if shutil.which("ffprobe") is None:
        raise RuntimeError("ffprobe not on PATH")

    on_log(f"Transcoding: VAAPI device={vaapi_dev}")

    duration_s = _probe_duration(src)
    on_log(f"Source duration: {duration_s:.1f}s")

    src_height = probe_video_height(src)
    src_kbps = probe_video_bitrate(src)
    if src_kbps:
        on_log(f"Source video bitrate: {src_kbps} kbps")
    else:
        on_log("Source video bitrate: unknown")
    if src_height:
        on_log(f"Source resolution: {src_height}p")

    # Cap output resolution: never upscale.
    effective_resolution = cfg.output_resolution
    if src_height and effective_resolution != "source":
        target_h = int(effective_resolution.rstrip("p"))
        if target_h > src_height:
            on_log(
                f"Capping resolution: {effective_resolution} → "
                f"source ({src_height}p, no upscale)"
            )
            effective_resolution = "source"

    cmd = _build_cmd(src, dst, cfg, source_bitrate_kbps=src_kbps,
                     effective_resolution=effective_resolution, title=title)
    use_sw = cfg.watermark_enabled and title and (cfg.watermark_font or _find_cjk_font())
    if use_sw:
        on_log("[tx] Watermark enabled → using software encoder (libx264)")
    else:
        on_log("[tx] Using VAAPI hardware encoder")
    on_log("$ " + " ".join(cmd))

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )

    import threading

    def drain_stderr() -> None:
        assert proc.stderr is not None
        for ln in proc.stderr:
            line = ln.rstrip()
            if line:
                on_log(f"[ffmpeg] {line}")

    t = threading.Thread(target=drain_stderr, name="ffmpeg-stderr", daemon=True)
    t.start()

    last_speed: float = 0.0
    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.rstrip()
        if not line:
            continue
        m = _OUT_TIME_RE.match(line)
        if m:
            current_us = int(m.group(1))
            pct = min(100.0, (current_us / 1_000_000) / duration_s * 100)
            on_progress(pct, f"speed={last_speed:.2f}x" if last_speed else "")
            continue
        sm = _SPEED_RE.match(line)
        if sm:
            try:
                last_speed = float(sm.group(1))
            except ValueError:
                pass

    rc = proc.wait(timeout=3600)
    t.join(timeout=5)
    if rc != 0:
        raise RuntimeError(
            f"ffmpeg exited with code {rc} (see log above for VAAPI errors)"
        )
    if not dst.exists() or dst.stat().st_size == 0:
        raise RuntimeError("ffmpeg produced no output file")
    on_log(f"Transcode done: {dst} ({dst.stat().st_size} bytes)")
    return TranscodeResult(path=dst)
