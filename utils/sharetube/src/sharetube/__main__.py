"""CLI entrypoint: `python -m sharetube` or `sharetube` (after install)."""
from __future__ import annotations

import argparse
import sys

from .app import ShareTubeApp


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="sharetube",
        description="TUI: yt-dlp → ffmpeg (VAAPI h264+aac @ 2Mbps) → share.krsz.in",
    )
    parser.add_argument(
        "--admin",
        action="store_true",
        help="Use CF_SHARE_ADMIN_USER / CF_SHARE_ADMIN_PASS from env to bypass quotas",
    )
    args = parser.parse_args(argv)

    app = ShareTubeApp(admin=args.admin)
    app.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())