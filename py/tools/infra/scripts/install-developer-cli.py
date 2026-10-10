#!/usr/bin/env python3
"""Install the optional developer CLI suite from prebuilt cargo-binstall artifacts."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


def infra_root() -> Path:
    """Find the checkout that owns the shared developer-tool catalog."""
    configured = os.environ.get("APHRODY_INFRA_ROOT")
    if configured:
        return Path(configured).resolve()

    script_root = Path(__file__).resolve().parents[1]
    if (script_root / "config" / "developer-cli-tools.json").is_file():
        return script_root

    workspace_root = Path(__file__).resolve().parents[3]
    return workspace_root.parent / "aphrody"


ROOT = infra_root()
MANIFEST = ROOT / "config" / "developer-cli-tools.json"


def load_manifest() -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if data.get("schema_version") != 1 or not isinstance(data.get("tools"), list):
        raise ValueError(f"Unsupported developer CLI manifest: {MANIFEST}")
    tools = data["tools"]
    for tool in tools:
        if not isinstance(tool, dict) or not all(
            isinstance(tool.get(key), str) and tool[key]
            for key in ("command", "package", "role")
        ):
            raise ValueError(f"Invalid tool entry: {tool!r}")
    plugins = data.get("nu_plugins", [])
    if not isinstance(plugins, list):
        raise TypeError(f"Invalid nu_plugins list: {plugins!r}")
    for plugin in plugins:
        if not isinstance(plugin, dict) or not all(
            isinstance(plugin.get(key), str) and plugin[key]
            for key in ("command", "package", "plugin", "role")
        ):
            raise ValueError(f"Invalid Nu plugin entry: {plugin!r}")
        if not re.fullmatch(r"[A-Za-z0-9_.+-]+", plugin["command"]):
            raise ValueError(
                f"Invalid Nu plugin executable name: {plugin['command']!r}"
            )
    return tools, plugins


def registered_plugins(nu: str) -> set[str]:
    result = subprocess.run(
        [nu, "-c", "plugin list | get name | to json"],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode:
        raise RuntimeError(
            f"Could not read the Nu plugin registry: {result.stderr.strip()}"
        )
    names = json.loads(result.stdout)
    if not isinstance(names, list) or not all(isinstance(name, str) for name in names):
        raise RuntimeError("Nu returned an invalid plugin registry.")
    return set(names)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="install missing tools; default only reports",
    )
    args = parser.parse_args()

    if sys.platform == "win32":
        print(
            "This optional interactive suite currently targets Unix-like developer hosts; use native package managers on Windows."
        )
        return 2

    try:
        tools, plugins = load_manifest()
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"Manifest error: {exc}", file=sys.stderr)
        return 2

    missing = [tool for tool in tools if shutil.which(tool["command"]) is None]
    missing_plugins = [
        plugin for plugin in plugins if shutil.which(plugin["command"]) is None
    ]
    present = len(tools) - len(missing)
    print(f"Developer CLI suite: {present}/{len(tools)} commands present.")
    for tool in missing:
        print(f"  {tool['command']:<12} {tool['role']} (crate: {tool['package']})")
    nu = shutil.which("nu")
    registered: set[str] = set()
    if nu:
        try:
            registered = registered_plugins(nu)
        except (OSError, RuntimeError, json.JSONDecodeError) as exc:
            print(f"Nu plugin registry unavailable: {exc}", file=sys.stderr)
            return 2
    missing_registrations = [
        plugin for plugin in plugins if plugin["plugin"] not in registered
    ]
    installed_plugins = len(plugins) - len(missing_plugins)
    registered_count = len(plugins) - len(missing_registrations)
    print(
        f"Nu plugins: {installed_plugins}/{len(plugins)} binaries installed; "
        f"{registered_count}/{len(plugins)} registered."
    )
    for plugin in missing_plugins:
        print(
            f"  {plugin['command']:<24} {plugin['role']} (crate: {plugin['package']})"
        )
    for plugin in plugins:
        if plugin["plugin"] in registered or plugin in missing_plugins:
            continue
        print(
            f"  {plugin['plugin']:<24} registered with `nu plugin add {plugin['command']}`"
        )
    if not missing and not missing_registrations:
        return 0
    if not args.apply:
        print("Check only. Re-run with --apply to install missing prebuilt releases.")
        return 0

    packages = list(
        dict.fromkeys(item["package"] for item in [*missing, *missing_plugins])
    )
    if packages:
        cargo = shutil.which("cargo")
        if cargo is None:
            print(
                "cargo is required; install the pinned Rust toolchain first.",
                file=sys.stderr,
            )
            return 2
        binstall = shutil.which("cargo-binstall")
        if binstall is None:
            print(
                "Installing cargo-binstall (locked); no project dependencies are modified."
            )
            result = subprocess.run(
                [cargo, "install", "cargo-binstall", "--locked"], check=False
            )
            if result.returncode:
                return result.returncode
            binstall = shutil.which("cargo-binstall")
            if binstall is None:
                print(
                    "cargo-binstall installed but not found on PATH; add Cargo's bin directory and retry.",
                    file=sys.stderr,
                )
                return 2
        result = subprocess.run(
            [
                binstall,
                "--no-confirm",
                "--locked",
                "--strategies",
                "crate-meta-data,quick-install",
                *packages,
            ],
            check=False,
        )
        if result.returncode:
            return result.returncode

    nu = shutil.which("nu")
    if nu is None:
        print(
            "Nu was not found after installation; cannot register Nu plugins.",
            file=sys.stderr,
        )
        return 2
    try:
        registered = registered_plugins(nu)
    except (OSError, RuntimeError, json.JSONDecodeError) as exc:
        print(f"Nu plugin registry unavailable: {exc}", file=sys.stderr)
        return 2

    for plugin in plugins:
        if plugin["plugin"] in registered:
            continue
        executable = shutil.which(plugin["command"])
        if executable is None:
            print(
                f"Nu plugin executable not found after installation: {plugin['command']}",
                file=sys.stderr,
            )
            return 2
        escaped_executable = executable.replace("'", "''")
        result = subprocess.run(
            [nu, "-c", f"plugin add '{escaped_executable}'"], check=False
        )
        if result.returncode:
            return result.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
