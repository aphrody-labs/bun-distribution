#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Cold-copy DBFR state for containers; existing host stores remain rollback sources."""

import argparse
import hashlib
import json
import os
import pathlib
import shutil
import subprocess


def inventory(root):
    rows = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise RuntimeError(
                "state symlink requires separate migration qualification"
            )
        if path.is_file():
            with path.open("rb") as stream:
                checksum = hashlib.file_digest(stream, "sha256").hexdigest()
            rows[str(path.relative_to(root))] = {
                "sha256": checksum,
                "bytes": path.stat().st_size,
            }
    return rows


def inactive(unit):
    result = subprocess.run(
        ["systemctl", "is-active", "--quiet", unit], capture_output=True, check=False
    )
    if result.returncode not in (3, 4):
        raise RuntimeError("host writers must be quiesced before state preparation")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--destination",
        type=pathlib.Path,
        default=pathlib.Path("/home/ubuntu/apps/shenron/shared/state"),
    )
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("run as root; protected stores are never made world-readable")
    sources = {
        "postgres/data": pathlib.Path("/var/lib/postgresql/18/main"),
        "postgres/config": pathlib.Path("/etc/postgresql/18/main"),
        "redis/data": pathlib.Path("/var/lib/redis"),
    }
    if not args.apply:
        print(
            "Plan: require all writers stopped; checksum-copy PG18 data/config and Redis RDB; retain source stores; no automatic cutover"
        )
        return
    destination = args.destination.resolve()
    if destination != pathlib.Path("/home/ubuntu/apps/shenron/shared/state") or destination.exists():
        parser.error("fresh canonical destination required")
    for unit in (
        "shenron-site.service",
        "shenron-bot.service",
        "shenron-site-docker.service",
        "shenron-bot-docker.service",
        "postgresql@18-main.service",
        "redis-server.service",
    ):
        inactive(unit)
    result = subprocess.run(
        [
            "docker",
            "ps",
            "--filter",
            "label=com.docker.compose.project=shenron",
            "--format",
            "{{.ID}}",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    if result.stdout.strip():
        parser.error("Shenron containers must be stopped before state preparation")
    if (sources["postgres/data"] / "postmaster.pid").exists():
        parser.error("PostgreSQL was not cleanly stopped")
    if (sources["postgres/data"] / "PG_VERSION").read_text().strip() != "18":
        parser.error("PostgreSQL major version mismatch")
    os.umask(0o077)
    destination.mkdir(parents=True, mode=0o711)
    receipt = {
        "schemaVersion": 1,
        "kind": "shenron-protected-state",
        "sourcesRetained": True,
        "copies": {},
    }
    # Copy to new destinations only; a failed copy is never used for activation.
    for name, source in sources.items():
        before = inventory(source)
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.parent.chmod(0o711)
        subprocess.run(
            ["cp", "--archive", "--", str(source), str(target)],
            check=True,
            capture_output=True,
        )
        if before != inventory(target) or before != inventory(source):
            raise RuntimeError(
                "protected state changed or checksum verification failed"
            )
        receipt["copies"][name] = before
    tls = destination / "postgres/tls"
    tls.mkdir(mode=0o700)
    os.chown(tls, 105, 111)
    for filename, source in (
        ("server.crt", pathlib.Path("/etc/ssl/certs/ssl-cert-snakeoil.pem")),
        ("server.key", pathlib.Path("/etc/ssl/private/ssl-cert-snakeoil.key")),
    ):
        target = tls / filename
        shutil.copyfile(source, target)
        os.chown(target, 105, 111)
        target.chmod(0o600)
    receipt["postgresTls"] = inventory(tls)
    config = destination / "redis/config"
    config.mkdir(mode=0o700)
    # Preserve protected Redis authentication/ACL directives, normalize owned paths.
    original = pathlib.Path("/etc/redis/redis.conf")
    shutil.copy2(original, config / "redis.conf")
    with (config / "redis.conf").open("a") as stream:
        stream.write(
            '\nbind 127.0.0.1\nport 6379\ndir /data\ndbfilename dump.rdb\ndaemonize no\nsupervised no\nlogfile ""\npidfile /tmp/redis.pid\n'
        )
    os.chown(config, 104, 110)
    os.chown(config / "redis.conf", 104, 110)
    config.chmod(0o750)
    (config / "redis.conf").chmod(0o640)
    receipt["redisConfigSha256"] = hashlib.sha256(
        (config / "redis.conf").read_bytes()
    ).hexdigest()
    (destination / "VERIFIED.json").write_text(
        json.dumps(receipt, sort_keys=True) + "\n"
    )
    print(
        "Protected state checksum-verified; original host stores retained; activation not performed"
    )


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.SubprocessError):
        raise SystemExit(
            "State preparation failed; protected originals retained; inspect privately"
        )
