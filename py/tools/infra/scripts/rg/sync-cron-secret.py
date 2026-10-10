#!/usr/bin/env python3
"""Copy the existing RG website CRON_SECRET to the protected cron env."""

import os
import tempfile
from pathlib import Path

ROOT = Path("/etc/rose-griffon")


def read(path: Path) -> dict[str, str]:
    if path.stat().st_mode & 0o777 != 0o600:
        raise ValueError(f"protected env must be 0600: {path}")
    return dict(
        line.split("=", 1)
        for line in path.read_text().splitlines()
        if line and not line.startswith("#") and "=" in line
    )


def main() -> None:
    if os.geteuid() != 0:
        raise PermissionError("root required")
    website = read(ROOT / "website.env")
    cron_path = ROOT / "rg-cron.env"
    cron = read(cron_path)
    secret = website.get("CRON_SECRET", "")
    if not secret:
        raise ValueError("CRON_SECRET missing from website.env")
    if cron.get("CRON_SECRET") == secret:
        print("CRON_SECRET already aligned")
        return
    cron["CRON_SECRET"] = secret
    fd, temporary = tempfile.mkstemp(prefix=".rg-cron.env.", dir=ROOT)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            for key in sorted(cron):
                out.write(f"{key}={cron[key]}\n")
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, cron_path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print("CRON_SECRET aligned")


if __name__ == "__main__":
    main()
