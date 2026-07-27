"""
Settings screen for sharetube.

A modal Textual screen with form fields for the runtime settings that
`Config` exposes. Press ``S`` from the main screen to open it. Press
``ctrl+s`` to save (and dismiss), ``escape`` to discard changes.

Persists via ``Config.save`` to ``$XDG_CONFIG_HOME/sharetube/config.json``.
The main app hot-reloads its `self.cfg` from disk on dismiss so the
next pipeline run picks up the new values.
"""
from __future__ import annotations

from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Grid, Horizontal, Vertical
from textual.screen import ModalScreen
from textual.widgets import (
    Button,
    Input,
    Label,
    Pretty,
    Select,
    Static,
    Switch,
)

from .config import (
    DEFAULTS,
    DEFAULT_TTL_SECONDS,
    OUTPUT_RESOLUTION_CHOICES,
    RESOLUTION_CHOICES,
    TTL_PRESETS,
    Config,
)


class SettingsScreen(ModalScreen[Config | None]):
    """Edit the sharetube runtime config. Returns the new Config on
    save, or None on cancel."""

    BINDINGS = [
        Binding("ctrl+s", "save", "Save", show=True),
        Binding("escape", "cancel", "Cancel", show=True),
    ]

    CSS = """
    SettingsScreen {
        align: center middle;
    }
    #settings-panel {
        width: 80; max-width: 95%;
        height: auto; max-height: 90%;
        overflow-y: auto;
        border: thick $accent;
        background: $surface;
        padding: 1 2;
    }
    #settings-title {
        text-style: bold;
        color: $accent;
        margin-bottom: 1;
    }
    .field-label {
        margin-top: 1;
        color: $text-muted;
    }
    .field-help {
        color: $text-muted;
        text-style: italic;
        margin-bottom: 1;
    }
    Input, Select {
        width: 100%;
    }
    #settings-buttons {
        margin-top: 1;
        height: 3;
        align-horizontal: right;
    }
    #settings-buttons Button {
        margin-left: 1;
    }
    #settings-error {
        color: $error;
        margin-top: 1;
    }
    """

    def __init__(self, current: Config) -> None:
        super().__init__()
        self._current = current
        # Working copy so cancel is non-destructive.
        self._draft = current

    def compose(self) -> ComposeResult:
        with Vertical(id="settings-panel"):
            yield Static("sharetube — Settings", id="settings-title")

            yield Label("cf-share base URL", classes="field-label")
            yield Static(
                "Where to upload (default https://share.krsz.in).",
                classes="field-help",
            )
            yield Input(
                value=self._current.app_url,
                id="app_url",
                placeholder="https://share.krsz.in",
            )

            yield Label("Video bitrate", classes="field-label")
            yield Static(
                "Target bitrate for h264_vaapi (e.g. 2M, 4M, 1500k).",
                classes="field-help",
            )
            yield Input(
                value=self._current.video_bitrate,
                id="video_bitrate",
                placeholder="2M",
            )

            yield Label("Audio bitrate", classes="field-label")
            yield Static(
                "AAC bitrate (e.g. 128k, 192k).",
                classes="field-help",
            )
            yield Input(
                value=self._current.audio_bitrate,
                id="audio_bitrate",
                placeholder="128k",
            )

            yield Label("Encoder preset", classes="field-label")
            yield Static(
                "x264 speed/quality tradeoff (used when watermark is on).",
                classes="field-help",
            )
            yield Select(
                [
                    ("ultrafast (fastest, lowest quality)", "ultrafast"),
                    ("superfast", "superfast"),
                    ("veryfast", "veryfast"),
                    ("faster", "faster"),
                    ("fast", "fast"),
                    ("medium (default)", "medium"),
                    ("slow", "slow"),
                    ("slower", "slower"),
                    ("veryslow (slowest, best quality)", "veryslow"),
                ],
                value=self._current.encoder_preset,
                id="encoder_preset",
                allow_blank=False,
            )

            yield Label("Max source resolution", classes="field-label")
            yield Static(
                "Cap downloaded video at this height. 'best' = no cap.",
                classes="field-help",
            )
            yield Select(
                [(r, r) for r in RESOLUTION_CHOICES],
                value=self._current.max_resolution
                if self._current.max_resolution in RESOLUTION_CHOICES
                else "1080p",
                id="max_resolution",
                allow_blank=False,
            )

            yield Label("Output resolution", classes="field-label")
            yield Static(
                "Downscale to this height on the GPU. 'source' = keep "
                "the downloaded resolution (no rescale).",
                classes="field-help",
            )
            yield Select(
                [(r, r) for r in OUTPUT_RESOLUTION_CHOICES],
                value=self._current.output_resolution
                if self._current.output_resolution in OUTPUT_RESOLUTION_CHOICES
                else "1080p",
                id="output_resolution",
                allow_blank=False,
            )

            yield Label("VAAPI device", classes="field-label")
            yield Static(
                "Render node (e.g. /dev/dri/renderD128). "
                "Must exist or transcode will fail.",
                classes="field-help",
            )
            yield Input(
                value=self._current.vaapi_device,
                id="vaapi_device",
                placeholder="/dev/dri/renderD128",
            )

            yield Label("Share lifetime (TTL)", classes="field-label")
            yield Static(
                "How long the share link stays valid. Default 1 day; "
                "range 5 min – 7 days.",
                classes="field-help",
            )
            yield Select(
                [(label, secs) for label, secs in TTL_PRESETS],
                value=self._current.ttl_seconds
                if self._current.ttl_seconds in {s for _, s in TTL_PRESETS}
                else DEFAULT_TTL_SECONDS,
                id="ttl_seconds",
                allow_blank=False,
            )

            yield Static("", id="settings-error")

            # Watermark section
            yield Label("Watermark", classes="field-label")
            yield Static(
                "Overlay video info (title, duration, specs) on the top-left.",
                classes="field-help",
            )
            yield Switch(
                value=self._current.watermark_enabled,
                id="watermark_enabled",
            )

            yield Label("Watermark font size", classes="field-label")
            yield Static(
                "Pixel size of the watermark text.",
                classes="field-help",
            )
            yield Input(
                value=str(self._current.watermark_font_size),
                id="watermark_font_size",
                placeholder="28",
            )

            yield Label("Watermark font path", classes="field-label")
            yield Static(
                "Leave empty to auto-detect a CJK font.",
                classes="field-help",
            )
            yield Input(
                value=self._current.watermark_font,
                id="watermark_font",
                placeholder="(auto-detect)",
            )

            yield Label("Watermark line 1", classes="field-label")
            yield Static(
                "Top line of the watermark (e.g. brand name).",
                classes="field-help",
            )
            yield Input(
                value=self._current.watermark_line1,
                id="watermark_line1",
                placeholder="KRSZ Share",
            )

            yield Label("Watermark line 2", classes="field-label")
            yield Static(
                "Bottom line. Tokens: {title} {resolution} {duration} {bitrate} {codec}.",
                classes="field-help",
            )
            yield Input(
                value=self._current.watermark_line2,
                id="watermark_line2",
                placeholder="{title} · {resolution} · {duration}",
            )

            with Horizontal(id="settings-buttons"):
                yield Button("Reset to defaults", id="reset", variant="warning")
                yield Button("Cancel", id="cancel", variant="default")
                yield Button("Save", id="save", variant="primary")

    # ── helpers ────────────────────────────────────────────────────────
    def _err(self, msg: str) -> None:
        self.query_one("#settings-error", Static).update(msg)

    def _values(self) -> dict[str, object]:
        return {
            "app_url": self.query_one("#app_url", Input).value.strip(),
            "video_bitrate": self.query_one("#video_bitrate", Input).value.strip(),
            "audio_bitrate": self.query_one("#audio_bitrate", Input).value.strip(),
            "encoder_preset": self.query_one("#encoder_preset", Select).value,
            "max_resolution": self.query_one(
                "#max_resolution", Select
            ).value,  # type: ignore[assignment]
            "output_resolution": self.query_one(
                "#output_resolution", Select
            ).value,  # type: ignore[assignment]
            "vaapi_device": self.query_one("#vaapi_device", Input).value.strip(),
            "ttl_seconds": int(
                self.query_one("#ttl_seconds", Select).value  # type: ignore[arg-type]
            ),
            "watermark_enabled": self.query_one("#watermark_enabled").value,
            "watermark_font_size": self.query_one("#watermark_font_size", Input).value.strip(),
            "watermark_font": self.query_one("#watermark_font", Input).value.strip(),
            "watermark_line1": self.query_one("#watermark_line1", Input).value.strip(),
            "watermark_line2": self.query_one("#watermark_line2", Input).value.strip(),
        }

    def _validate(self, vals: dict[str, object]) -> str | None:
        if not str(vals["app_url"]).startswith(("http://", "https://")):
            return "cf-share base URL must start with http:// or https://"
        # Bitrate validation: ffmpeg accepts "2M" / "1500k" / "2000000".
        for k in ("video_bitrate", "audio_bitrate"):
            v = str(vals[k])
            if not v or v[-1].lower() not in ("k", "m"):
                return f"{k} must end with 'k' or 'M' (e.g. 2M, 128k)"
            head = v[:-1]
            if not head.isdigit():
                return f"{k} numeric part must be an integer (got {head!r})"
        if vals["max_resolution"] not in RESOLUTION_CHOICES:
            return f"max_resolution must be one of {RESOLUTION_CHOICES}"
        if vals["output_resolution"] not in OUTPUT_RESOLUTION_CHOICES:
            return f"output_resolution must be one of {OUTPUT_RESOLUTION_CHOICES}"
        if not vals["vaapi_device"]:
            return "VAAPI device path is empty"
        try:
            ttl = int(vals["ttl_seconds"])  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return "ttl_seconds must be an integer"
        if ttl < 300 or ttl > 7 * 24 * 60 * 60:
            return "ttl_seconds must be between 300 (5 min) and 604800 (7 days)"
        return None

    # ── actions ────────────────────────────────────────────────────────
    def action_save(self) -> None:
        vals = self._values()
        err = self._validate(vals)
        if err:
            self._err(err)
            return
        new_cfg = Config.from_json(vals)
        new_cfg.save()
        self.dismiss(new_cfg)

    def action_cancel(self) -> None:
        self.dismiss(None)

    def on_button_pressed(self, event: Button.Pressed) -> None:
        bid = event.button.id
        if bid == "save":
            self.action_save()
        elif bid == "cancel":
            self.action_cancel()
        elif bid == "reset":
            # Restore the form to DEFAULTS without persisting yet; user
            # still has to press Save.
            self.query_one("#app_url", Input).value = DEFAULTS["app_url"]
            self.query_one("#video_bitrate", Input).value = DEFAULTS["video_bitrate"]
            self.query_one("#audio_bitrate", Input).value = DEFAULTS["audio_bitrate"]
            self.query_one("#encoder_preset", Select).value = "medium"
            self.query_one(
                "#max_resolution", Select
            ).value = DEFAULTS["max_resolution"]
            self.query_one(
                "#output_resolution", Select
            ).value = DEFAULTS["output_resolution"]
            self.query_one("#vaapi_device", Input).value = DEFAULTS["vaapi_device"]
            self.query_one(
                "#ttl_seconds", Select
            ).value = DEFAULT_TTL_SECONDS
            self.query_one("#watermark_enabled").value = True
            self.query_one("#watermark_font_size", Input).value = "28"
            self.query_one("#watermark_font", Input).value = ""
            self.query_one("#watermark_line1", Input).value = "KRSZ Share"
            self.query_one("#watermark_line2", Input).value = "{title} · {resolution} · {duration}"
            self._err("")
