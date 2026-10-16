#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Stage qualified public CDN artifacts in a fresh, unsealed Docker release."""

import argparse
import hashlib
import json
import pathlib
import re
import shutil


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def inventory(root):
    if root.is_symlink() or not root.is_dir():
        raise ValueError("public artifact directory required")
    files = {}
    for path in root.rglob("*"):
        rel = path.relative_to(root).as_posix()
        if path.is_symlink():
            raise ValueError("public artifacts must not contain symlinks")
        if path.is_dir():
            continue
        if (
            not path.is_file()
            or any(
                part.startswith(".") and part != ".well-known"
                for part in path.relative_to(root).parts
            )
            or path.suffix.lower()
            in {".env", ".sql", ".sqlite", ".db", ".bak", ".key", ".pem"}
        ):
            raise ValueError("protected or special artifact refused")
        files[rel] = digest(path)
    return files


def stage(release, artifact, previous=None):
    if release.is_symlink() or artifact.is_symlink():
        raise ValueError("symlink root refused")
    release = release.resolve(strict=True)
    artifact = artifact.resolve(strict=True)
    if (release / "release.json").exists() or not re.fullmatch(
        r"docker-[a-f0-9]{40}", release.name
    ):
        raise ValueError("fresh unsealed Docker release required")
    compose = json.loads((release / "compose.yaml").read_text())
    if "gateway" not in compose.get("services", {}):
        raise ValueError("assembled gateway required")
    volumes = compose["services"]["gateway"].setdefault("volumes", [])
    public_mounts = [
        volume
        for volume in volumes
        if isinstance(volume, dict)
        and isinstance(volume.get("target"), str)
        and volume["target"].endswith("/shenron-cdn/site")
    ]
    if len(public_mounts) != 1:
        raise ValueError("exactly one gateway public CDN mount required")
    public_mount = public_mounts[0]
    public_target = pathlib.PurePosixPath(public_mount["target"])
    if (
        not public_target.is_absolute()
        or ".." in public_target.parts
        or public_mount.get("type") != "bind"
        or public_mount.get("source") != str(release / "public")
        or public_mount.get("read_only") is not True
    ):
        raise ValueError("qualified gateway public CDN bind mount required")
    target_mount = str(public_target.parent / "_next")
    if any(volume.get("target") == target_mount for volume in volumes):
        raise ValueError("gateway chunk mount already declared")
    sources = [
        (artifact / "site", release / "public", False),
        (artifact / "_next/static", release / "cdn/_next/static", True),
    ]
    if previous is not None:
        if previous.is_symlink():
            raise ValueError("previous chunk root symlink refused")
        previous = previous.resolve(strict=True)
        if not (previous / "release.json").is_file():
            raise ValueError("sealed previous release required")
        old = previous / "cdn/_next/static"
        if old.exists():
            manifest = json.loads((previous / "release.json").read_text())
            observed = inventory(old)
            if any(
                manifest.get("files", {}).get("cdn/_next/static/" + rel) != sha
                for rel, sha in observed.items()
            ):
                raise ValueError("previous chunk digest differs from sealed release")
            sources.insert(1, (old, release / "cdn/_next/static", True))
    # Validate all inputs and immutable-name collisions before writing anything.
    planned = {}
    for source, target, immutable in sources:
        files = inventory(source)
        if not files:
            raise ValueError("empty public artifact refused")
        for rel, sha in files.items():
            dst = target / rel
            if immutable and (
                (dst in planned and planned[dst][1] != sha)
                or (dst.exists() and digest(dst) != sha)
            ):
                raise ValueError("immutable chunk collision")
            planned[dst] = (source / rel, sha)
    for dst, (source, sha) in planned.items():
        if dst.is_symlink() or any(parent.is_symlink() for parent in dst.parents):
            raise ValueError("destination symlink refused")
    for dst, (source, sha) in planned.items():
        dst.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        # Private job umasks must not make public bind-mounted trees unreadable.
        # Only the fresh release's public/CDN subtree belongs to this operation.
        for directory in dst.parents:
            if directory == release:
                break
            directory.chmod(0o755)
        shutil.copy2(source, dst)
        dst.chmod(0o644)
        if digest(dst) != sha:
            raise ValueError("staged artifact digest mismatch")
    volumes.append(
        {
            "type": "bind",
            "source": str(release / "cdn/_next"),
            "target": target_mount,
            "read_only": True,
        }
    )
    (release / "compose.yaml").write_text(json.dumps(compose, indent=2) + "\n")
    return {
        "schema": "shenron-public-cdn-stage/v1",
        "release": str(release),
        "files": {
            dst.relative_to(release).as_posix(): sha
            for dst, (_, sha) in planned.items()
        },
        "sealed": False,
        "activated": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("release", type=pathlib.Path)
    parser.add_argument("--artifact", required=True, type=pathlib.Path)
    parser.add_argument("--previous", type=pathlib.Path)
    args = parser.parse_args()
    try:
        print(
            json.dumps(
                stage(args.release, args.artifact, args.previous), sort_keys=True
            )
        )
    except (ValueError, OSError):
        parser.error(
            "CDN staging refused; inspect artifact and release contract privately"
        )


if __name__ == "__main__":
    main()
