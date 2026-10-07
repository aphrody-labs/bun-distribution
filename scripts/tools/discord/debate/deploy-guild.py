# SPDX-License-Identifier: Apache-2.0
"""Plan/apply a source-built bot-only Compose update; retain the existing state and rollback image."""

import argparse
import hashlib
import json
import os
import pathlib
import re
import subprocess
import time
import urllib.request


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(args, env=None):
    result = subprocess.run(
        args, env=env, capture_output=True, text=True, timeout=120, check=False
    )
    if result.returncode:
        raise RuntimeError("Scoped Docker operation failed")
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", type=pathlib.Path, required=True)
    parser.add_argument("--binary-sha256", required=True)
    parser.add_argument("--drop-in-sha256", required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-f0-9]{40}", args.revision) or not re.fullmatch(
        r"[a-f0-9]{64}", args.binary_sha256
    ):
        raise ValueError("Verified source revision and binary checksum required")
    if (
        args.stage.parent != pathlib.Path("/tmp")
        or not re.fullmatch(r"aphrody-guild-[a-z0-9]+", args.stage.name)
        or args.stage.is_symlink()
    ):
        raise ValueError("Bounded staging directory required")
    binary = args.stage / "shenron-bot"
    if binary.is_symlink() or digest(binary) != args.binary_sha256:
        raise ValueError("Candidate binary checksum mismatch")
    drop_in_source = args.stage / "guild-admission.conf"
    if drop_in_source.is_symlink() or digest(drop_in_source) != args.drop_in_sha256:
        raise ValueError("Declared systemd drop-in checksum mismatch")
    current = json.loads(run(["docker", "inspect", "shenron-bot-1"]))[0]
    old_image = current["Image"]
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", old_image):
        raise ValueError("Immutable rollback image required")
    prior_additional = next(
        (
            line.split("=", 1)[1]
            for line in current["Config"]["Env"]
            if line.startswith("ADDITIONAL_GUILD_IDS=")
        ),
        "",
    )
    guilds = list(
        dict.fromkeys(
            [value.strip() for value in prior_additional.split(",") if value.strip()]
            + ["1554189180030947338"]
        )
    )
    if any(not re.fullmatch(r"\d{17,20}", guild) for guild in guilds):
        raise ValueError("Malformed existing guild allowlist")
    candidate = "localhost/shenron-bot:admitted-" + args.revision[:12]
    root = pathlib.Path("/srv/shenron/shared/debate")
    override = root / "guild-admission.override.json"
    compose = pathlib.Path("/srv/shenron/current/compose.yaml")
    print(
        json.dumps(
            {
                "plan": True,
                "sourceRevision": args.revision,
                "binarySha256": args.binary_sha256,
                "previousImage": old_image,
                "candidate": candidate,
                "additionalGuildIds": guilds,
                "services": ["bot"],
                "state": "existing protected mounts",
                "override": str(override),
            }
        ),
        flush=True,
    )
    if not args.apply:
        return
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    env = dict(os.environ)
    for line in (compose.parent / "deploy.env").read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            key, value = line.split("=", 1)
            env[key] = value.strip().strip("\"'")
    base = "localhost/shenron-bot:admission-base-" + old_image[7:19]
    run(["docker", "tag", old_image, base])
    binary.chmod(0o755)
    (args.stage / ".dockerignore").write_text("*\n!Dockerfile\n!shenron-bot\n")
    (args.stage / "Dockerfile").write_text(
        f"FROM {base}\nCOPY shenron-bot /usr/local/bin/shenron-bot\nLABEL org.opencontainers.image.revision={args.revision}\n"
    )
    run(["docker", "build", "--network", "none", "--tag", candidate, str(args.stage)])
    smoke = json.loads(
        run(
            [
                "docker",
                "run",
                "--rm",
                "--network",
                "none",
                "--cap-drop",
                "ALL",
                "--entrypoint",
                "/usr/local/bin/shenron-bot",
                candidate,
                "--smoke",
            ]
        )
    )
    if smoke.get("smoke") != "ok":
        raise ValueError("Candidate image smoke failed")
    new_image = json.loads(run(["docker", "image", "inspect", candidate]))[0]["Id"]
    previous = override.read_bytes() if override.exists() else None
    if previous is not None:
        backup = root / f"override-before-{args.revision[:12]}.json"
        backup.write_bytes(previous)
        backup.chmod(0o600)
        if backup.read_bytes() != previous:
            raise ValueError("Override backup verification failed")
    desired = {
        "services": {
            "bot": {
                "image": new_image,
                "environment": {"ADDITIONAL_GUILD_IDS": ",".join(guilds)},
            }
        }
    }
    temporary = override.with_suffix(".tmp")
    temporary.write_text(json.dumps(desired, indent=2) + "\n")
    temporary.chmod(0o600)
    temporary.replace(override)
    command = [
        "docker",
        "compose",
        "-f",
        str(compose),
        "-f",
        str(override),
        "up",
        "-d",
        "--no-build",
        "--no-deps",
        "bot",
    ]
    drop_in = pathlib.Path(
        "/etc/systemd/system/shenron-bot-docker.service.d/guild-admission.conf"
    )
    previous_drop_in = drop_in.read_bytes() if drop_in.exists() else None
    drop_in_changed = False
    try:
        run(command, env)
        healthy = False
        for _ in range(20):
            try:
                with urllib.request.urlopen(
                    "http://127.0.0.1:5006/health", timeout=2
                ) as response:
                    healthy = response.status == 200
            except (OSError, ValueError):
                healthy = False
            if healthy:
                break
            time.sleep(1)
        deployed = json.loads(run(["docker", "inspect", "shenron-bot-1"]))[0]
        old_mounts = sorted(
            (m["Source"], m["Destination"], m["RW"]) for m in current["Mounts"]
        )
        new_mounts = sorted(
            (m["Source"], m["Destination"], m["RW"]) for m in deployed["Mounts"]
        )
        if not healthy or deployed["Image"] != new_image or old_mounts != new_mounts:
            raise RuntimeError(
                "Bot health, image or protected mount verification failed"
            )
        drop_in.parent.mkdir(mode=0o755, exist_ok=True)
        if drop_in.exists():
            backup = root / "guild-admission-before.conf"
            backup.write_bytes(drop_in.read_bytes())
            backup.chmod(0o600)
            if digest(backup) != digest(drop_in):
                raise ValueError("Systemd drop-in backup checksum mismatch")
        drop_in.write_bytes(drop_in_source.read_bytes())
        drop_in.chmod(0o644)
        drop_in_changed = True
        run(
            [
                "systemd-analyze",
                "verify",
                "/etc/systemd/system/shenron-bot-docker.service",
            ]
        )
        run(["systemctl", "daemon-reload"])
        if "guild-admission.override.json" not in run(
            [
                "systemctl",
                "show",
                "--property=ExecStart",
                "--value",
                "shenron-bot-docker.service",
            ]
        ):
            raise RuntimeError("Persistent service override not active")
    except (RuntimeError, OSError, ValueError, subprocess.SubprocessError):
        rollback = (
            previous
            or json.dumps(
                {
                    "services": {
                        "bot": {
                            "image": old_image,
                            "environment": {"ADDITIONAL_GUILD_IDS": prior_additional},
                        }
                    }
                }
            ).encode()
        )
        override.write_bytes(rollback)
        override.chmod(0o600)
        if drop_in_changed:
            if previous_drop_in is None:
                drop_in.unlink()
            else:
                drop_in.write_bytes(previous_drop_in)
                drop_in.chmod(0o644)
            run(["systemctl", "daemon-reload"])
        run(command, env)
        raise RuntimeError("Candidate rejected; previous bot image restored") from None
    receipt = {
        "applied": True,
        "sourceRevision": args.revision,
        "binarySha256": args.binary_sha256,
        "image": new_image,
        "previousImage": old_image,
        "health": "ok",
        "protectedMountsPreserved": True,
        "additionalGuildIds": guilds,
    }
    (root / "guild-admission-receipt.json").write_text(
        json.dumps(receipt, indent=2) + "\n"
    )
    (root / "guild-admission-receipt.json").chmod(0o600)
    print(json.dumps(receipt))


if __name__ == "__main__":
    main()
