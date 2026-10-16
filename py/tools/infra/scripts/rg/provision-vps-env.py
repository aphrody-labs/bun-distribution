#!/usr/bin/env python3
"""Materialize RG production env files from protected operator inputs.

No credentials are embedded in the repository or printed by this command.
Run as root on the VPS with a private staging directory; remove staging after
the release has been built.
"""

from __future__ import annotations

import argparse
import os
import re
import tempfile
from pathlib import Path

KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
CLOUD_MARKERS = (".supabase.co", ".neon.tech", ".vercel.app")
DROP_KEYS = {
    "BLOB_READ_WRITE_TOKEN",
    "GITHUB__ACCESS__TOKEN",
    "NODE_AUTH_TOKEN",
    "NPM_TOKEN",
    "POSTGRES_DATABASE",
    "POSTGRES_HOST",
    "POSTGRES_PASSWORD",
    "POSTGRES_PRISMA_URL",
    "POSTGRES_URL",
    "POSTGRES_URL_NON_POOLING",
    "POSTGRES_USER",
    "SUBBASE_ACCESS_TOKEN",
    "SUPABASE_ACCESS_TOKEN",
    "TURBO_TOKEN",
    "VERCEL_OIDC_TOKEN",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
}


def read_env(path: Path) -> dict[str, str]:
    if not path.is_file() or path.stat().st_mode & 0o777 != 0o600:
        raise ValueError(f"protected input missing or not 0600: {path}")
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.lstrip().startswith("#"):
            continue
        key, sep, raw = line.partition("=")
        if not sep or not KEY.fullmatch(key):
            raise ValueError(f"invalid env syntax in {path}")
        values[key] = raw
    return values


def clean(values: dict[str, str]) -> dict[str, str]:
    return {
        key: value
        for key, value in values.items()
        if key not in DROP_KEYS
        and not any(marker in value.lower() for marker in CLOUD_MARKERS)
    }


def require(values: dict[str, str], *keys: str) -> None:
    missing = [key for key in keys if not values.get(key)]
    if missing:
        raise ValueError("required production keys missing: " + ", ".join(missing))


def write_env(path: Path, values: dict[str, str]) -> None:
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as out:
            for key in sorted(values):
                out.write(f"{key}={values[key]}\n")
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--stage", type=Path, default=Path("/home/ubuntu/.rg-deploy-stage")
    )
    parser.add_argument("--target", type=Path, default=Path("/etc/rose-griffon"))
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if args.apply and os.geteuid() != 0:
        parser.error("--apply requires root")

    root = read_env(args.stage / "root.env")
    website_source = read_env(args.stage / "website.env")
    bot_source = read_env(args.stage / "bot.env")
    cron_source = read_env(args.stage / "cron.env")
    cdn_source = read_env(args.stage / "cdn.env")
    achillea_source = read_env(args.target / "achillea.env")
    api_source = read_env(args.target / "rg-api.env")

    # One identity boundary and one RG PostgREST JWT set. The old Achillea JWTs
    # are signed by a different key and cannot authenticate against RG.
    require(
        root,
        "SUPABASE_JWT_SECRET",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
    )
    require(website_source, "DATABASE_URL", "BETTER_AUTH_SECRET")
    require(achillea_source, "DATABASE_URL", "BOT_TOKEN")
    shared = {
        "SUPABASE_JWT_SECRET": root["SUPABASE_JWT_SECRET"],
        "SUPABASE_SERVICE_ROLE_KEY": root["SUPABASE_SERVICE_ROLE_KEY"],
        "NEXT_PUBLIC_SUPABASE_ANON_KEY": root["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
        "SUPABASE_INTERNAL_URL": "http://127.0.0.1:8811",
        "NEXT_PUBLIC_SUPABASE_URL": "https://rosegriffon.fr",
        "SUPABASE_URL": "https://rosegriffon.fr",
    }
    website = (
        clean(website_source)
        | shared
        | {
            "BETTER_AUTH_URL": "https://rosegriffon.fr",
            "NEXT_PUBLIC_API_URL": "https://api.rosegriffon.fr",
            "NEXT_PUBLIC_BASE_URL": "https://rosegriffon.fr",
            "NEXT_PUBLIC_SITE_URL": "https://rosegriffon.fr",
            "NEXT_PUBLIC_URL": "https://rosegriffon.fr",
        }
    )
    api = (
        clean(api_source)
        | shared
        | {
            "DATABASE_URL": website_source["DATABASE_URL"],
            "BETTER_AUTH_SECRET": website_source["BETTER_AUTH_SECRET"],
            "BETTER_AUTH_URL": "https://rosegriffon.fr",
            "PUBLIC_API_URL": "https://api.rosegriffon.fr",
        }
    )
    for key in ("DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET"):
        if website_source.get(key):
            api[key] = website_source[key]
    bot = (
        clean(bot_source)
        | shared
        | {
            "DATABASE_URL": website_source["DATABASE_URL"],
            "NEXT_PUBLIC_SUPABASE_URL": "https://rosegriffon.fr",
        }
    )
    cron = (
        clean(cron_source)
        | shared
        | {
            "DATABASE_URL": website_source["DATABASE_URL"],
            "NEXT_PUBLIC_SUPABASE_URL": "https://rosegriffon.fr",
        }
    )
    if website_source.get("CRON_SECRET"):
        cron["CRON_SECRET"] = website_source["CRON_SECRET"]
    cdn = clean(cdn_source) | {
        "CDN_HOST": "127.0.0.1",
        "CDN_PORT": "8801",
        "CDN_PUBLIC_BASE": "https://cdn.rosegriffon.fr",
        "CDN_STORAGE": "/var/www/cdn/static/rg/public",
    }
    achillea = (
        clean(achillea_source)
        | shared
        | {
            "SUPABASE_ANON_KEY": root["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
            "SUPABASE_SERVICE_KEY": root["SUPABASE_SERVICE_ROLE_KEY"],
            "SUPABASE_URL": "https://achillea.rosegriffon.fr",
            "UNIFIED_API_URL": "https://api.rosegriffon.fr",
        }
    )
    files = {
        "website.env": website,
        "rg-api.env": api,
        "rg-bot.env": bot,
        "rg-cron.env": cron,
        "rg-cdn.env": cdn,
        "rg-achillea-bot.env": achillea,
    }
    for name, values in files.items():
        for key, value in values.items():
            if (
                not KEY.fullmatch(key)
                or "\n" in value
                or any(x in value.lower() for x in CLOUD_MARKERS)
            ):
                raise ValueError(f"invalid production value: {name}:{key}")
        require(
            values, *("DATABASE_URL",) if name != "rg-cdn.env" else ("CDN_STORAGE",)
        )
        if args.apply:
            write_env(args.target / name, values)
        print(f"{name}: {'written' if args.apply else 'ready'} ({len(values)} keys)")


if __name__ == "__main__":
    main()
