"""
Shared config for ad-hoc test scripts.

Kept in sync with `lib/config/app.ts` (the TypeScript source of truth).
If you change `APP_URL` there, mirror the change here too — or, better,
extend this file to read from a single generated JSON manifest.

ADMIN_USER / ADMIN_PASS are the same S3 access key/secret used for HTTP
Basic auth on `/api/admin/...`. Override via env vars
CF_SHARE_ADMIN_USER / CF_SHARE_ADMIN_PASS, or set them in .env.

No default credentials are baked in — you must supply them via env.
"""
import os

APP_URL = os.environ.get("CF_SHARE_BASE", "https://share.krsz.in")
APP_HOST = APP_URL.split("//", 1)[-1].rstrip("/")


def _need_admin_user():
    v = os.environ.get("CF_SHARE_ADMIN_USER")
    if not v:
        raise RuntimeError(
            "CF_SHARE_ADMIN_USER is not set. Export it or put it in your env "
            "(same value as S3_ACCESS_KEY_ID in .dev.vars)."
        )
    return v


def _need_admin_pass():
    v = os.environ.get("CF_SHARE_ADMIN_PASS")
    if not v:
        raise RuntimeError(
            "CF_SHARE_ADMIN_PASS is not set. Export it or put it in your env "
            "(same value as S3_SECRET_ACCESS_KEY in .dev.vars)."
        )
    return v


ADMIN_USER = _need_admin_user()
ADMIN_PASS = _need_admin_pass()