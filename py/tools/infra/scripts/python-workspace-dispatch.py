#!/usr/bin/env python3
"""Dispatch legacy Infra script paths into the shared Aphrody Python workspace."""

from __future__ import annotations

import os
import sys
from pathlib import Path

TARGETS = {
    "install-developer-cli.py": "scripts/install-developer-cli.py",
    "provision-vps-env.py": "scripts/rg/provision-vps-env.py",
    "prune-vps-releases.py": "scripts/rg/prune-vps-releases.py",
    "sync-cron-secret.py": "scripts/rg/sync-cron-secret.py",
    "test_prune_vps_releases.py": "scripts/rg/test_prune_vps_releases.py",
    "smoke-aphrody-stack-local.py": "scripts/smoke-aphrody-stack-local.py",
}


def main() -> int:
    script_name = Path(sys.argv[0]).name
    relative_target = TARGETS.get(script_name)
    if relative_target is None:
        print(
            f"unsupported Python workspace entry point: {script_name}", file=sys.stderr
        )
        return 2

    configured_root = os.environ.get("APHRODY_PY_ROOT")
    module_path = Path(__file__).resolve()
    python_root = next(
        (
            parent
            for parent in module_path.parents
            if (parent / "uv.lock").is_file()
            and (parent / "tools/infra/scripts/python-workspace-dispatch.py").is_file()
        ),
        Path(configured_root).expanduser().resolve()
        if configured_root
        else Path.home() / "aphrody-py",
    )
    invoked_path = Path(sys.argv[0]).absolute()
    infra_root = next(
        (
            parent
            for parent in invoked_path.parents
            if (parent / "config/developer-cli-tools.json").is_file()
        ),
        Path(os.environ.get("APHRODY_INFRA_ROOT", python_root.parent / "aphrody")),
    )
    target = python_root / "tools/infra" / relative_target
    if not target.is_file():
        print(
            f"Aphrody Python workspace entry point is missing: {target}; "
            "set APHRODY_PY_ROOT to the workspace checkout",
            file=sys.stderr,
        )
        return 2

    environment = os.environ.copy()
    environment.setdefault("APHRODY_INFRA_ROOT", str(infra_root))
    if script_name == "test_prune_vps_releases.py":
        command = [
            "uv",
            "run",
            "--locked",
            "--project",
            str(python_root),
            "pytest",
            str(target),
            *sys.argv[1:],
        ]
    else:
        command = [
            "uv",
            "run",
            "--locked",
            "--project",
            str(python_root),
            "python",
            str(target),
            *sys.argv[1:],
        ]
    try:
        os.execvpe(command[0], command, environment)
    except FileNotFoundError:
        print("uv is required to run Infra Python commands", file=sys.stderr)
        return 127
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
