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
import shutil
import sqlite3
import subprocess
import tempfile
from contextlib import closing

ROOT = pathlib.Path("/home/ubuntu/apps/shenron/shared")
BACKUPS = ROOT / "backups/container"


def run(args, **kwargs):
    result = subprocess.run(
        args, stderr=subprocess.PIPE, check=False, timeout=600, **kwargs
    )
    if result.returncode:
        raise RuntimeError("backup operation failed; no credentials logged")
    return result


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main():
    if os.geteuid() != 0:
        raise RuntimeError("run as root")
    os.umask(0o077)
    BACKUPS.mkdir(parents=True, mode=0o700, exist_ok=True)
    with (BACKUPS / ".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        usage = sum(p.stat().st_size for p in BACKUPS.rglob("*") if p.is_file())
        if usage > 8 * 1024**3 or shutil.disk_usage(BACKUPS).free < 4 * 1024**3:
            raise RuntimeError(
                "backup capacity gate failed; existing backups preserved"
            )
        stage = pathlib.Path(tempfile.mkdtemp(prefix=".snapshot-", dir=BACKUPS))
        database = stage / "shenron_site.dump"
        with database.open("wb") as output:
            run(
                [
                    "docker",
                    "exec",
                    "aphrody-postgres-1",
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
            raise RuntimeError(
                "suspicious PostgreSQL snapshot; retained for private inspection"
            )
        with database.open("rb") as source:
            run(
                [
                    "docker",
                    "exec",
                    "-i",
                    "aphrody-postgres-1",
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
                raise RuntimeError("live SQLite store missing or symlinked")
            relative = path.relative_to(ROOT)
            snapshot = stage / relative
            snapshot.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            with (
                closing(
                    sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
                ) as source,
                closing(sqlite3.connect(snapshot)) as target,
            ):
                source.backup(target)
                if target.execute("PRAGMA quick_check").fetchone() != ("ok",):
                    raise RuntimeError("SQLite snapshot integrity failed")
            with (
                snapshot.open("rb") as source,
                gzip.open(str(snapshot) + ".gz", "wb") as target,
            ):
                shutil.copyfileobj(source, target)
            with gzip.open(str(snapshot) + ".gz", "rb") as stream:
                while stream.read(1024 * 1024):
                    pass
            snapshot.unlink()
        redis_snapshot = "/data/" + stage.name + ".rdb"
        run(
            [
                "docker",
                "exec",
                "aphrody-redis-1",
                "redis-cli",
                "--rdb",
                redis_snapshot,
            ],
            stdout=subprocess.DEVNULL,
        )
        run(
            [
                "docker",
                "exec",
                "aphrody-redis-1",
                "redis-check-rdb",
                redis_snapshot,
            ],
            stdout=subprocess.DEVNULL,
        )
        with (stage / "redis.rdb").open("wb") as output:
            run(
                ["docker", "exec", "aphrody-redis-1", "cat", redis_snapshot],
                stdout=output,
            )
        run(
            ["docker", "exec", "aphrody-redis-1", "rm", "--", redis_snapshot],
            stdout=subprocess.DEVNULL,
        )
        files = {
            str(p.relative_to(stage)): digest(p)
            for p in stage.rglob("*")
            if p.is_file()
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
        print("Shenron container snapshots verified: " + str(destination))


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, sqlite3.Error, subprocess.SubprocessError):
        raise SystemExit(
            "Shenron container backup failed; protected snapshots retained, no credentials logged"
        ) from None
