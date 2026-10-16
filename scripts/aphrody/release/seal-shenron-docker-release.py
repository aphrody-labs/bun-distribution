#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Seal an already assembled Docker release without copying private runtime data."""

import argparse
import hashlib
import json
import pathlib
import re
from shenron_deployment_identity import deployment, require_release_name


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("release", type=pathlib.Path)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--deployment", type=pathlib.Path)
    parser.add_argument("--image-id", required=True)
    parser.add_argument("--public-vfs", required=True, type=pathlib.Path)
    parser.add_argument("--gateway-image-id")
    parser.add_argument("--gateway-commit")
    parser.add_argument(
        "--service-image",
        nargs=3,
        action="append",
        default=[],
        metavar=("ROLE", "IMAGE_ID", "COMMIT"),
    )
    args = parser.parse_args()
    for value, pattern in (
        (args.commit, r"[a-f0-9]{40}"),
        (args.image_id, r"sha256:[a-f0-9]{64}"),
    ):
        if not re.fullmatch(pattern, value):
            parser.error("invalid immutable release identity")
    if bool(args.gateway_image_id) != bool(args.gateway_commit):
        parser.error("gateway image ID and revision must be supplied together")
    if args.gateway_image_id and (
        not re.fullmatch(r"sha256:[a-f0-9]{64}", args.gateway_image_id)
        or not re.fullmatch(r"[a-f0-9]{40}", args.gateway_commit)
    ):
        parser.error("invalid immutable gateway identity")
    release = args.release.resolve(strict=True)
    try:
        selected = deployment(json.loads(args.deployment.read_text()) if args.deployment else None, args.commit)
        require_release_name(release.name, args.commit, selected)
    except ValueError as error:
        parser.error(str(error))
    files = {}
    for path in release.rglob("*"):
        relative = path.relative_to(release).as_posix()
        if path.is_symlink():
            parser.error("release must not contain symlinks")
        if not path.is_file() or relative == "release.json":
            continue
        # Only declared public configuration/static content may be sealed.
        if relative not in ("compose.yaml", "deploy.env") and not relative.startswith(
            ("nginx/", "public/", "cdn/_next/static/")
        ):
            parser.error(
                "unexpected release file; protected stores remain outside releases"
            )
        files[relative] = digest(path)
    if not {"compose.yaml", "deploy.env"}.issubset(files):
        parser.error("Compose and deploy.env required")
    manifest = {
        "schemaVersion": 1,
        "runtime": "docker",
        "repository": "shenron",
        "target": "dbfr",
        "commit": args.commit,
        "imageId": args.image_id,
        "files": files,
        "publicVfs": {
            "path": str(args.public_vfs.resolve(strict=True)),
            "sha256": digest(args.public_vfs),
        },
    }
    if selected:
        manifest["deployment"] = selected
    if args.gateway_image_id:
        manifest["images"] = {
            "gateway": {"id": args.gateway_image_id, "commit": args.gateway_commit}
        }
    for role, identity, revision in args.service_image:
        if (
            role not in ("postgres", "redis", "chat")
            or not re.fullmatch(r"sha256:[a-f0-9]{64}", identity)
            or not re.fullmatch(r"[a-f0-9]{40}", revision)
        ):
            parser.error("invalid protected service image identity")
        manifest.setdefault("images", {})[role] = {"id": identity, "commit": revision}
    output = release / "release.json"
    with output.open("x") as stream:
        json.dump(manifest, stream, indent=2, sort_keys=True)
        stream.write("\n")
    print("Docker release sealed; run canonical adapter verify before activation")


if __name__ == "__main__":
    main()
