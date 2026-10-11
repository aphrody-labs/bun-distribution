#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Install the declared DBFR-only private compute prerequisites; plan by default."""

import argparse
import hashlib
import json
import os
import pathlib
import pwd
import re
import shutil
import subprocess
import urllib.parse

ROOT = pathlib.Path("/home/ubuntu/apps/shenron")


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def compute_environment(environment):
    """Reuse the live caller's credentials, without copying a different domain."""
    database = environment.get("DATABASE_URL", "")
    url = urllib.parse.urlsplit(database)
    if (
        url.scheme not in ("postgres", "postgresql")
        or url.hostname != "127.0.0.1"
        or url.port != 5432
        or url.path != "/shenron_site"
    ):
        raise ValueError("DBFR loopback PostgreSQL configuration required")
    tokens = [
        environment.get(k)
        for k in ("APHRODY_AI_HTTP_TOKEN", "APHRODY_SHENRON_API_TOKEN")
        if environment.get(k)
    ]
    if not tokens or len(set(tokens)) != 1 or len(tokens[0]) < 32:
        raise ValueError("one qualified compute credential required")
    query = urllib.parse.parse_qs(url.query, keep_blank_values=True)
    query["options"] = ["-c search_path=shenron_compute,public"]
    database = urllib.parse.urlunsplit(
        url._replace(query=urllib.parse.urlencode(query, doseq=True, quote_via=urllib.parse.quote))
    )
    return {
        "APHRODY_MCP_DATABASE_URL": database,
        "APHRODY_AI_HTTP_TOKEN": tokens[0],
        "APHRODY_SHENRON_API_TOKEN": tokens[0],
        "APHRODY_MCP_HTTP_TOKEN": tokens[0],
        "APHRODY_SHENRON_PRODUCTION_READY": "1",
        "APHRODY_AI_CHAT_BASE_URL": "http://127.0.0.1:8799/v1",
        "APHRODY_AI_CHAT_MODEL": "shenron-chat-v2",
        "APHRODY_AI_EMBED_BASE_URL": "http://127.0.0.1:8085/v1",
        "APHRODY_AI_EMBED_MODEL": "Xenova/multilingual-e5-small",
        "REDIS_URL": "redis://127.0.0.1:6379",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime-artifact", required=True, type=pathlib.Path)
    parser.add_argument("--runtime-sha256", required=True)
    parser.add_argument("--checkout", required=True, type=pathlib.Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{64}", args.runtime_sha256):
        parser.error("immutable runtime checksum required")
    if not args.apply:
        print(
            "Plan: verify installed runtime; check the DBFR compose services shenron-compute/shenron-embed; reuse caller credentials; preserve stores; no corpus mutation or activation"
        )
        return
    if os.geteuid() != 0 or not (ROOT / "current").is_symlink():
        raise ValueError("root on the qualified DBFR Shenron host required")
    release = json.loads((ROOT / "current/release.json").read_text())
    if release.get("target") != "dbfr" or release.get("runtime") != "docker":
        raise ValueError("qualified DBFR container release required")
    if digest(args.runtime_artifact) != args.runtime_sha256:
        raise ValueError("runtime checksum mismatch")
    container = json.loads(
        subprocess.check_output(["docker", "inspect", "aphrody-site-1"])
    )[0]
    if container["State"]["Health"]["Status"] != "healthy":
        raise ValueError("healthy caller required")
    environment = dict(x.split("=", 1) for x in container["Config"]["Env"] if "=" in x)
    values = compute_environment(environment)
    user = pwd.getpwnam("ubuntu")
    home = ROOT / "shared/agent-home"
    if home.is_symlink():
        raise ValueError("domain home symlink refused")
    home.mkdir(mode=0o700, exist_ok=True)
    os.chown(home, user.pw_uid, user.pw_gid)
    installation = pathlib.Path("/home/ubuntu/.local/lib/aphrody") / (
        "shenron-" + args.runtime_sha256[:16]
    )
    installation.mkdir(parents=True, mode=0o755, exist_ok=True)
    target = installation / "aphrody"
    if target.exists():
        if target.is_symlink() or digest(target) != args.runtime_sha256:
            raise ValueError("installed runtime identity conflict")
    else:
        shutil.copyfile(args.runtime_artifact, target)
        target.chmod(0o755)
        if digest(target) != args.runtime_sha256:
            raise ValueError("installed runtime copy failed checksum")
    bin_root = pathlib.Path("/home/ubuntu/.local/bin")
    bin_root.mkdir(parents=True, exist_ok=True)
    for name in ("aphrody-mcp", "aphrody-embed"):
        link = bin_root / name
        if link.is_symlink() and link.resolve() == target:
            continue
        if link.exists() or link.is_symlink():
            raise ValueError("existing runtime alias requires explicit reconciliation")
        link.symlink_to(target)
    config = pathlib.Path("/etc/aphrody/shenron-compute.env")
    config.parent.mkdir(mode=0o700, exist_ok=True)
    body = "".join(k + "=" + json.dumps(v) + "\n" for k, v in values.items())
    if config.exists():
        if (
            config.is_symlink()
            or config.stat().st_mode & 0o777 != 0o600
            or config.read_text() != body
        ):
            raise ValueError("existing private configuration conflict")
    else:
        descriptor = os.open(config, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
    # compute and embed run as the compose services shenron-compute/shenron-embed on aphrody:toolbox
    # (tools/config/container/compose.yaml), never as host units.
    subprocess.run(
        ["docker", "compose", "--project-directory", "/home/ubuntu/apps", "config", "-q"],
        check=True,
    )
    print(
        "DBFR private compute prerequisites installed; corpus, model and activation gates remain"
    )


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError):
        raise SystemExit(
            "Shenron AI prerequisite installation failed; no credential values logged"
        ) from None
