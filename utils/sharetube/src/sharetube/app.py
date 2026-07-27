"""
Textual TUI for sharetube.

Layout:
  ┌──────────────────────────────────────────────────────┐
  │ cf-share file sharetube  │  Status: Idle             │
  ├──────────────────────────────────────────────────────┤
  │ URL:  [____________________________]  [Start]        │
  ├──────────────────────────────────────────────────────┤
  │ Download   ████████░░░░░░░░░░  42%   5.2MiB/s        │
  │ Transcode  ░░░░░░░░░░░░░░░░░░   0%                    │
  │ Upload     ░░░░░░░░░░░░░░░░░░   0%                    │
  ├──────────────────────────────────────────────────────┤
  │ Log                                                  │
  │ > yt-dlp Destination: foo.mp4                        │
  │ > Transcoding with VAAPI (h264_vaapi)                │
  └──────────────────────────────────────────────────────┘

The 3 phases run sequentially on a worker thread so the UI stays
responsive. Progress callbacks marshal updates back to the main thread
via `call_from_thread`.
"""
from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Optional

from textual import on, work
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical
from textual.widgets import (
    Button,
    Footer,
    Header,
    Input,
    ProgressBar,
    RichLog,
    Static,
)

from . import download as dl_mod
from . import transcode as tx_mod
from . import upload as up_mod
from .config import Config
from .settings_screen import SettingsScreen


PHASES = ("Download", "Transcode", "Upload")



class PhaseRow(Static):
    """One labelled progress row. Bar + meta live as named children."""

    def __init__(self, label: str, **kwargs) -> None:
        super().__init__(classes=f"phase-row {label.lower()}-row", **kwargs)
        self._label = label
        self._bar_id = f"bar-{label.lower()}"
        self._meta_id = f"meta-{label.lower()}"

    def compose(self) -> ComposeResult:
        with Horizontal():
            yield Static(self._label, classes="phase-label")
            yield ProgressBar(total=100, show_eta=False, id=self._bar_id)
            yield Static("", id=self._meta_id, classes="phase-meta")

    def on_mount(self) -> None:
        self._bar = self.query_one(f"#{self._bar_id}", ProgressBar)
        self._meta = self.query_one(f"#{self._meta_id}", Static)

    def update(self, pct: float, meta: str = "") -> None:
        self._bar.update(progress=pct)
        self._meta.update(meta)


class ShareTubeApp(App):
    CSS = """
    Screen { padding: 1 2 }
    #url-row { height: 3; margin-bottom: 1 }
    #url-row Input { width: 1fr }
    #url-row Button { width: auto; min-width: 10; margin-left: 1 }
    .phase-row { height: 3; layout: horizontal }
    .phase-label { width: 12; padding: 1 1 0 0; text-style: bold }
    ProgressBar { width: 1fr }
    .phase-meta { width: 36; padding: 1 0 0 1; color: $accent }
    #share-row { height: 3; display: none; margin-top: 1 }
    #share-url { width: 1fr }  
    #share-row Button { width: auto; min-width: 12; margin-left: 1 }
    #log {
        height: 1fr; border: round $accent;
        margin-top: 1; padding: 0 1
    }
    """

    BINDINGS = [
        Binding("ctrl+c", "quit", "Quit", show=True),
        Binding("s", "settings", "Settings", show=True),
        Binding("c", "copy_link", "Copy link", show=True),

    ]

    def __init__(self, admin: bool = False) -> None:
        super().__init__()
        self.cfg = Config.load()
        self._admin = admin
        self._tmpdir: Optional[tempfile.TemporaryDirectory] = None
        self._share_url: Optional[str] = None
        self._direct_url: Optional[str] = None
        self.title = "sharetube"
        self._set_subtitle("Idle")

    def on_mount(self) -> None:
        # Show the current settings in the sub-title so the user knows
        # what they have configured.
        self._set_subtitle(self._settings_summary(self.cfg))

    @staticmethod
    def _settings_summary(cfg: Config) -> str:
        out = (
            f"v={cfg.video_bitrate} a={cfg.audio_bitrate} "
            f"src≤{cfg.max_resolution} → {cfg.output_resolution} "
            f"ttl={cfg.ttl_seconds // 3600}h"
        )
        return out

    def compose(self) -> ComposeResult:
        yield Header(show_clock=False)
        with Horizontal(id="url-row"):
            yield Input(placeholder="https://...", id="url-input")
            yield Button("Clear", id="clear-btn", variant="default")
            yield Button("Start", id="start-btn", variant="primary")
        for label in PHASES:
            yield PhaseRow(label)
        with Horizontal(id="share-row"):
            yield Input(value="", id="share-url", disabled=True)
            yield Button("Copy link", id="copy-btn", variant="success")
        yield RichLog(id="log", highlight=True, markup=False, wrap=True)
        yield Footer()

    # ── helpers ──────────────────────────────────────────────────────────
    def _log(self, msg: str) -> None:
        self.query_one("#log", RichLog).write(msg)

    def _phase(self, label: str) -> PhaseRow:
        return self.query_one(f".{label.lower()}-row", PhaseRow)

    def _set_subtitle(self, text: str) -> None:
        self.sub_title = text

    # ── actions ────────────────────────────────────────────────────────────
    def action_copy_link(self) -> None:
        """Copy the direct download URL to clipboard."""
        if not self._direct_url:
            self._log("No share link to copy yet.")
            return
        self._copy_to_clipboard(self._direct_url)

    @staticmethod
    def _copy_to_clipboard(text: str) -> None:
        """Copy text to the system clipboard."""
        import pyperclip
        try:
            pyperclip.copy(text)
        except Exception:
            pass

    def action_settings(self) -> None:
        """Open the settings modal. The returned value (new Config or
        None for cancel) is handled in `_on_settings_dismiss`."""
        self.push_screen(SettingsScreen(self.cfg), self._on_settings_dismiss)

    def _on_settings_dismiss(self, new_cfg: Config | None) -> None:
        if new_cfg is None:
            return
        self.cfg = new_cfg
        self._log(
            f"Settings saved: v={new_cfg.video_bitrate} "
            f"a={new_cfg.audio_bitrate} src≤{new_cfg.max_resolution} "
            f"→ {new_cfg.output_resolution} ttl={new_cfg.ttl_seconds}s "
            f"device={new_cfg.vaapi_device}"
        )
        self._set_subtitle(self._settings_summary(new_cfg))

    # ── UI events ────────────────────────────────────────────────────────
    @on(Input.Submitted, "#url-input")
    @on(Button.Pressed, "#start-btn")
    def _start(self) -> None:
        url = self.query_one("#url-input", Input).value.strip()
        if not url:
            self._log("Enter a URL first.")
            return
        # Hide share row on new pipeline
        self.query_one("#share-row").display = False
        self._share_url = None
        self._direct_url = None
        self.query_one("#start-btn", Button).disabled = True
        self.query_one("#url-input", Input).disabled = True
        self._run_pipeline(url)

    @on(Button.Pressed, "#clear-btn")
    def _on_clear_btn(self) -> None:
        """Clear the URL input."""
        self.query_one("#url-input", Input).value = ""

    @on(Button.Pressed, "#copy-btn")
    def _on_copy_btn(self) -> None:
        self.action_copy_link()

    # ── background pipeline ─────────────────────────────────────────────
    @work(exclusive=True, thread=True)
    async def _run_pipeline(self, url: str) -> None:
        # Caches so we don't query on each callback.
        phase_cache = {label: self._phase(label) for label in PHASES}
        # Reset all progress bars on new pipeline.
        for phase in phase_cache.values():
            phase.update(0.0, "")

        def ui_log(msg: str) -> None:
            self.call_from_thread(self._log, msg)

        def ui_status(text: str) -> None:
            self.call_from_thread(self._set_subtitle, text)

        def ui_progress(label: str, pct: float, meta: str = "") -> None:
            self.call_from_thread(phase_cache[label].update, pct, meta)

        try:
            # Clean up previous run's temp files.
            if self._tmpdir is not None:
                self._tmpdir.cleanup()
            self._tmpdir = tempfile.TemporaryDirectory(prefix="sharetube-")
            tmpdir = Path(self._tmpdir.name)
            ui_log(f"Tmpdir: {tmpdir}")

            # Phase 1: download
            ui_status("Downloading")
            dl_res = dl_mod.download(
                url, tmpdir, self.cfg,
                on_progress=lambda pct, meta: ui_progress("Download", pct, meta),
                on_log=lambda m: ui_log(f"[dl] {m}"),
            )
            # Show source video specs next to the Download row
            src_specs = tx_mod.probe_video(dl_res.path)
            ui_progress("Download", 100.0, src_specs)

            # Phase 2: transcode (bitrate capped at source level)
            ui_status("Transcoding")
            ui_progress("Transcode", 0.0, src_specs)
            mp4_out = tmpdir / "out.mp4"
            tx_mod.transcode(
                dl_res.path, mp4_out, self.cfg,
                on_progress=lambda pct, meta: ui_progress("Transcode", pct, meta),
                on_log=lambda m: ui_log(f"[tx] {m}"),
                title=dl_res.title,
            )
            # Show transcoded output specs
            out_specs = tx_mod.probe_video(mp4_out)
            ui_progress("Transcode", 100.0, out_specs)

            # Phase 3: upload
            ui_status("Uploading")
            up_res = up_mod.upload(
                mp4_out, self.cfg,
                on_log=lambda m: ui_log(f"[up] {m}"),
                on_progress=lambda pct, meta: ui_progress("Upload", pct, meta),
                filename=dl_res.path.name,
            )

            ui_status("Done")
            self._share_url = up_res.share_url
            # Show the share row with the copy button
            self.call_from_thread(self._show_share_row, up_res.share_url, up_res.share_token)
            ui_log(
                f"\n✓ Share URL: {up_res.share_url}\n"
                f"  Token: {up_res.share_token}\n"
                f"  Expires: {up_res.expires_at}"
            )
        except Exception as e:
            ui_status("Error")
            ui_log(f"✗ {type(e).__name__}: {e}")
        finally:
            self.call_from_thread(self._reenable_inputs)

    def _show_share_row(self, share_url: str, token: str) -> None:
        """Display the share URL row with the copy button."""
        # The direct download link bypasses the HTML download page.
        direct = f"{self.cfg.app_url}/api/download/{token}"
        self._direct_url = direct
        self.query_one("#share-url", Input).value = direct
        self.query_one("#share-row").display = True

    def _reenable_inputs(self) -> None:
        self.query_one("#start-btn", Button).disabled = False
        self.query_one("#url-input", Input).disabled = False

    def on_unmount(self) -> None:
        if self._tmpdir is not None:
            self._tmpdir.cleanup()