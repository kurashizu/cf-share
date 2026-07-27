"""
Runtime configuration for sharetube.

Mirrors `cf-share/lib/config/app.ts` for the public app URL. Keep those
two values in sync when changing the production hostname. S3 endpoint is
intentionally not exposed here — uploads go through the share.krsz.in
Worker API, not directly to S3.

Settings can come from three sources, in increasing priority:

  1. The persisted user config file at ``$XDG_CONFIG_HOME/sharetube/config.json``
     (typically ``~/.config/sharetube/config.json``). Created/updated by
     the TUI settings screen.
  2. Environment variables (``SHARETUBE_VIDEO_BITRATE`` etc.). Useful for
     one-off overrides from the shell.
  3. Built-in defaults (``2M`` / ``128k`` / ``1080p`` / ``/dev/dri/renderD128``).
"""
from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path

# Default upload target (cf-share). Mirrors `lib/config/app.ts` APP_URL.
DEFAULT_APP_URL = "https://share.krsz.in"

# Built-in defaults. TUI "Reset to defaults" action restores these.
DEFAULTS: dict[str, str] = {
    "app_url": DEFAULT_APP_URL,
    "video_bitrate": "2M",
    "audio_bitrate": "128k",
    "max_resolution": "1080p",     # download-side: yt-dlp ceiling
    "output_resolution": "1080p",  # transcode-side: VAAPI downscale target
    "vaapi_device": "/dev/dri/renderD128",
    "ttl_seconds": "86400",        # 1 day; sent to /api/upload/init as `ttl`
}

# Choices the TUI offers for the resolution dropdowns.
RESOLUTION_CHOICES: tuple[str, ...] = (
    "2160p", "1440p", "1080p", "720p", "480p", "360p", "best",
)
# "source" means: keep the downloaded resolution (no downscale on transcode).
OUTPUT_RESOLUTION_CHOICES: tuple[str, ...] = (
    "source", "2160p", "1440p", "1080p", "720p", "480p", "360p",
)

# TTL presets shown in the TUI, in seconds. Custom values can still be
# entered directly in the input field.
TTL_PRESETS: tuple[tuple[str, int], ...] = (
    ("5 min", 5 * 60),
    ("1 h", 60 * 60),
    ("6 h", 6 * 60 * 60),
    ("1 day", 24 * 60 * 60),
    ("3 days", 3 * 24 * 60 * 60),
    ("7 days", 7 * 24 * 60 * 60),
)
DEFAULT_TTL_SECONDS = 24 * 60 * 60  # 1 day


def _config_path() -> Path:
    base = os.environ.get("XDG_CONFIG_HOME")
    if base:
        return Path(base) / "sharetube" / "config.json"
    return Path.home() / ".config" / "sharetube" / "config.json"


@dataclass(frozen=True)
class Config:
    # ── upload target ─────────────────────────────────────────────────────
    app_url: str = DEFAULT_APP_URL
    # ── transcode ─────────────────────────────────────────────────────────
    video_bitrate: str = "2M"   # ffmpeg -b:v
    audio_bitrate: str = "128k"  # ffmpeg -b:a
    encoder_preset: str = "medium"  # libx264 preset (watermark path)
    vaapi_device: str = "/dev/dri/renderD128"
    # `source` keeps the downloaded resolution; otherwise downscale to
    # this height on the GPU (2160p / 1440p / 1080p / 720p / 480p / 360p).
    output_resolution: str = "1080p"
    # ── download ──────────────────────────────────────────────────────────
    # 2160p / 1440p / 1080p / 720p / 480p / 360p / best
    max_resolution: str = "1080p"
    # ── share lifetime ────────────────────────────────────────────────────
    # TTL passed to /api/upload/init. Range 300 (5 min) to 604800 (7 days)
    # per cf-share's API. Stored as int (seconds).
    ttl_seconds: int = DEFAULT_TTL_SECONDS
    # ── watermark ────────────────────────────────────────────────────────
    watermark_enabled: bool = True
    watermark_font_size: int = 28
    watermark_font: str = ""
    watermark_line1: str = "KRSZ Share"
    watermark_line2: str = "{title} · {resolution} · {duration}"

    def to_json(self) -> dict:
        return asdict(self)

    @classmethod
    def from_json(cls, data: dict) -> "Config":
        """Build a Config from a partial dict, falling back to defaults for
        unknown / missing keys. Ignores unknown fields so a future
        version's settings file still works on older binaries.

        Coerces ``ttl_seconds`` to int (form values come in as strings).
        """
        if not isinstance(data, dict):
            return cls.load()
        known = {f.name for f in fields(cls)}
        out: dict[str, object] = {k: v for k, v in data.items() if k in known}
        if "ttl_seconds" in out:
            try:
                out["ttl_seconds"] = int(out["ttl_seconds"])  # type: ignore[arg-type]
            except (TypeError, ValueError):
                out["ttl_seconds"] = DEFAULT_TTL_SECONDS
        if "watermark_font_size" in out:
            try:
                out["watermark_font_size"] = int(out["watermark_font_size"])  # type: ignore[arg-type]
            except (TypeError, ValueError):
                out["watermark_font_size"] = 28
        if "watermark_enabled" in out:
            v = out["watermark_enabled"]
            if isinstance(v, str):
                out["watermark_enabled"] = v.lower() in ("true", "1", "yes")
        return cls(**out)  # type: ignore[arg-type]

    @classmethod
    def load(cls) -> "Config":
        """Load config: persisted file → env vars → defaults."""
        merged: dict[str, object] = dict(DEFAULTS)
        path = _config_path()
        if path.exists():
            try:
                merged.update(json.loads(path.read_text()))
            except (OSError, json.JSONDecodeError):
                pass
        # Env vars take precedence over persisted file.
        env_map = {
            "app_url": "CF_SHARE_BASE",
            "video_bitrate": "SHARETUBE_VIDEO_BITRATE",
            "audio_bitrate": "SHARETUBE_AUDIO_BITRATE",
            "vaapi_device": "SHARETUBE_VAAPI_DEVICE",
            "max_resolution": "SHARETUBE_MAX_RESOLUTION",
            "output_resolution": "SHARETUBE_OUTPUT_RESOLUTION",
            "ttl_seconds": "SHARETUBE_TTL_SECONDS",
        }
        for key, env in env_map.items():
            val = os.environ.get(env)
            if val:
                merged[key] = val
        # Coerce ttl_seconds to int (JSON has it as str, env too).
        try:
            merged["ttl_seconds"] = int(merged["ttl_seconds"])  # type: ignore[arg-type]
        except (TypeError, ValueError):
            merged["ttl_seconds"] = DEFAULT_TTL_SECONDS
        return cls(**{k: merged[k] for k in DEFAULTS if k in merged})

    def save(self) -> None:
        """Persist to the user config file. Best-effort; logs but does
        not raise on permission errors so the TUI keeps working even if
        ``~/.config`` is read-only."""
        path = _config_path()
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(self.to_json(), indent=2) + "\n")
        except OSError:
            pass
