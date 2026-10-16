#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Publish renewed Shenron certificate files to the declared gateway TLS store."""

import os
import pathlib
import stat
import subprocess
import tempfile

HOSTS = {
    "dragonballfr.com",
    "bot.dragonballfr.com",
    "cdn.dragonballfr.com",
    "mcp.dragonballfr.com",
    # Sites migrés du VPS le 2026-10-09 (même conteneur gateway sur dbfr).
    "aphrody.com",
    "bot.aphrody.com",
    "cdn.aphrody.com",
    "creator.aphrody.com",
    "downloads.aphrody.com",
    "rosegriffon.fr",
    "api.rosegriffon.fr",
    "cdn.rosegriffon.fr",
    "azalee.rosegriffon.fr",
    "mcp.rosegriffon.fr",
    "ranked.rosegriffon.fr",
}
SOURCE = pathlib.Path("/etc/letsencrypt")
TARGET = pathlib.Path("/etc/aphrody/shenron-tls")


def command(args):
    result = subprocess.run(args, capture_output=True, timeout=30, check=False)
    if result.returncode:
        raise RuntimeError("Shenron certificate validation or gateway reload failed")


def main():
    if os.geteuid() != 0:
        raise RuntimeError("run as root")
    requested = os.environ.get("RENEWED_LINEAGE")
    lineages = (
        [pathlib.Path(requested)]
        if requested
        else [SOURCE / "live" / h for h in sorted(HOSTS)]
    )
    changed = False
    for lineage in lineages:
        if lineage.name not in HOSTS:
            continue
        if lineage.parent != SOURCE / "live" or lineage.is_symlink():
            raise RuntimeError("unexpected certificate lineage")
        command(
            [
                "openssl",
                "x509",
                "-in",
                str(lineage / "fullchain.pem"),
                "-checkend",
                "3600",
                "-noout",
            ]
        )
        for name in ("cert.pem", "chain.pem", "fullchain.pem", "privkey.pem"):
            source = (lineage / name).resolve(strict=True)
            if not source.is_relative_to(SOURCE / "archive" / lineage.name):
                raise RuntimeError("certificate archive escapes its declared lineage")
            destination = TARGET / source.relative_to(SOURCE)
            destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            if destination.is_symlink():
                raise RuntimeError("certificate target archive is symlinked")
            with tempfile.NamedTemporaryFile(
                dir=destination.parent, delete=False
            ) as temporary:
                temporary.write(source.read_bytes())
                os.fchmod(temporary.fileno(), stat.S_IMODE(source.stat().st_mode))
                temporary.flush()
                os.fsync(temporary.fileno())
                staged = pathlib.Path(temporary.name)
            staged.replace(destination)
            live = TARGET / "live" / lineage.name / name
            live.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            staged_link = live.with_name("." + name + "." + str(os.getpid()))
            staged_link.symlink_to(os.path.relpath(destination, live.parent))
            staged_link.replace(live)
        changed = True
    if changed:
        command(["docker", "exec", "aphrody-gateway-1", "nginx", "-t"])
        command(["docker", "exec", "aphrody-gateway-1", "nginx", "-s", "reload"])
        print("Shenron gateway certificate files published and nginx reloaded")


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.SubprocessError):
        raise SystemExit(
            "Shenron certificate deployment failed; no credential values logged"
        ) from None
