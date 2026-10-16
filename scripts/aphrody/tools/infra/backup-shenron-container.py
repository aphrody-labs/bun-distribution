#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Back up the DBFR container-owned PostgreSQL, Redis and live SQLite stores."""

import datetime
import fcntl
import gzip
import hashlib
import json
import os
import pathlib
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from contextlib import closing

ROOT = pathlib.Path("/home/ubuntu/apps/shenron/shared")
BACKUPS = ROOT / "backups/container"
POSTGRES = os.environ.get("SHENRON_POSTGRES_CONTAINER", "shenron-postgres")
REDIS = os.environ.get("SHENRON_REDIS_CONTAINER", "shenron-redis")
# Owner policy: only the newest verified snapshot stays on the host; the VPS keeps the off-host copy.
KEEP = max(1, int(os.environ.get("SHENRON_BACKUP_KEEP", "1")))
SNAPSHOT = re.compile(r"^\d{8}T\d{12}Z$")


def run(step, args, **kwargs):
    result = subprocess.run(
        args, stderr=subprocess.DEVNULL, check=False, timeout=900, **kwargs
    )
    if result.returncode:
        raise RuntimeError(f"{step} failed (exit {result.returncode})")
    return result


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def snapshots():
    return sorted(
        p for p in BACKUPS.iterdir() if p.is_dir() and SNAPSHOT.match(p.name)
    )


def main():
    if os.geteuid() != 0:
        raise RuntimeError("run as root")
    os.umask(0o077)
    BACKUPS.mkdir(parents=True, mode=0o700, exist_ok=True)
    with (BACKUPS / ".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        # Stages of interrupted runs are never published; drop them before the capacity gate.
        for stale in BACKUPS.glob(".snapshot-*"):
            shutil.rmtree(stale, ignore_errors=True)
        usage = sum(p.stat().st_size for p in BACKUPS.rglob("*") if p.is_file())
        if usage > 8 * 1024**3 or shutil.disk_usage(BACKUPS).free < 4 * 1024**3:
            raise RuntimeError("capacity gate failed; existing backups preserved")
        stage = pathlib.Path(tempfile.mkdtemp(prefix=".snapshot-", dir=BACKUPS))
        try:
            destination = snapshot(stage)
        except BaseException:
            shutil.rmtree(stage, ignore_errors=True)
            raise
        for old in snapshots()[:-KEEP]:
            shutil.rmtree(old)
        print("Shenron container snapshots verified: " + str(destination))


def snapshot(stage):
    database = stage / "shenron_site.dump"
    with database.open("wb") as output:
        run(
            "pg_dump",
            [
                "docker",
                "exec",
                POSTGRES,
                "/usr/lib/postgresql/18/bin/pg_dump",
                "-U",
                "postgres",
                "-d",
                "shenron_site",
                "--format=custom",
                "--no-owner",
                "--no-privileges",
            ],
            stdout=output,
        )
    if database.stat().st_size < 10240:
        raise RuntimeError("suspicious PostgreSQL snapshot size")
    with database.open("rb") as source:
        run(
            "pg_restore --list",
            [
                "docker",
                "exec",
                "-i",
                POSTGRES,
                "/usr/lib/postgresql/18/bin/pg_restore",
                "--list",
            ],
            stdin=source,
            stdout=subprocess.DEVNULL,
        )
    paths = [
        ROOT / "bot/data/bot.db",
        ROOT / "server/data/memory.sqlite",
        ROOT / "server/data/conversations.sqlite",
    ]
    for path in paths:
        if not path.is_file() or path.is_symlink():
            raise RuntimeError("live SQLite store missing or symlinked: " + str(path))
        relative = path.relative_to(ROOT)
        copy = stage / relative
        copy.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with (
            closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as source,
            closing(sqlite3.connect(copy)) as target,
        ):
            source.backup(target)
            if target.execute("PRAGMA quick_check").fetchone() != ("ok",):
                raise RuntimeError("SQLite snapshot integrity failed: " + str(path))
        with copy.open("rb") as source, gzip.open(str(copy) + ".gz", "wb") as target:
            shutil.copyfileobj(source, target)
        with gzip.open(str(copy) + ".gz", "rb") as stream:
            while stream.read(1024 * 1024):
                pass
        copy.unlink()
    redis_snapshot = "/data/" + stage.name + ".rdb"
    try:
        run(
            "redis-cli --rdb",
            ["docker", "exec", REDIS, "redis-cli", "--rdb", redis_snapshot],
            stdout=subprocess.DEVNULL,
        )
        run(
            "redis-check-rdb",
            ["docker", "exec", REDIS, "redis-check-rdb", redis_snapshot],
            stdout=subprocess.DEVNULL,
        )
        with (stage / "redis.rdb").open("wb") as output:
            run(
                "redis rdb copy",
                ["docker", "exec", REDIS, "cat", redis_snapshot],
                stdout=output,
            )
    finally:
        subprocess.run(
            ["docker", "exec", REDIS, "rm", "-f", "--", redis_snapshot],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            timeout=60,
        )
    files = {
        str(p.relative_to(stage)): digest(p) for p in stage.rglob("*") if p.is_file()
    }
    (stage / "VERIFIED.json").write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "kind": "shenron-container-backup",
                "files": files,
                "sqliteIntegrity": "ok",
                "postgresArchiveList": "ok",
                "redisIntegrity": "ok",
            },
            indent=2,
        )
        + "\n"
    )
    for relative, checksum in files.items():
        if digest(stage / relative) != checksum:
            raise RuntimeError("backup checksum changed before publication")
    destination = BACKUPS / datetime.datetime.now(datetime.timezone.utc).strftime(
        "%Y%m%dT%H%M%S%fZ"
    )
    stage.rename(destination)
    return destination


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, ValueError, sqlite3.Error, subprocess.SubprocessError) as error:
        print(
            f"Shenron container backup failed: {error}; no credentials logged",
            file=sys.stderr,
        )
        raise SystemExit(1) from None
