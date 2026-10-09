#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Validate the Python workspace (locks, quality, installed wheels) in one entry point.

Run ``python tools/packaging/modernize_workspace.py check``. The one-time layout
migration that used to live here (``apply``) ran on 2026-10-03 and was removed when
`py/` was fused into the Aphrody monorepo. The wheel gates build the native extension
from the pinned Bun fork, so `check` needs Cargo: run it on the serialized
build host, never in WSL.
"""

from __future__ import annotations

import argparse
import email.parser
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import tomllib
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
PIN = "02fa7fa362d815f788074ae09998041b34f9a770"
FORK = "https://github.com/aphrody-labs/antigravity-sdk-python.git"
FORK_REQUIREMENT = f"google-antigravity @ git+{FORK}@{PIN}"
SDK = ROOT / "packages/aphrody"


def run(*args: str, cwd: Path = ROOT) -> None:
    """Execute a checked command without a shell."""
    print("+ " + " ".join(args), flush=True)
    subprocess.run(args, cwd=cwd, check=True)


def write(path: Path, text: str) -> None:
    """Write UTF-8/LF source only when the content changes."""
    content = text.replace("\r\n", "\n").encode()
    if path.exists() and path.read_bytes() == content:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)


def load(path: Path) -> dict[str, Any]:
    """Read package metadata without importing application code."""
    return tomllib.loads(path.read_text(encoding="utf-8"))


def validation_report() -> None:
    """Record successful gates and hashes without collecting private runtime state."""
    members = load(ROOT / "pyproject.toml")["tool"]["uv"]["workspace"]["members"]
    sources = [
        path for member in members for path in (ROOT / member / "src").rglob("*.py")
    ]
    report = {
        "schemaVersion": 1,
        "migration": "Python workspace modernization",
        "supportedPlatform": "linux",
        "members": members,
        "gates": {
            "isolatedLocks": "pass",
            "lint": "pass",
            "format": "pass",
            "types": "pass",
            "workspaceTests": "pass",
            "installedDistributions": "pass",
        },
        "files": {
            str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(sources)
        },
        "limitations": [
            "Live cloud APIs, model quality, CUDA and Blender require dedicated Linux integration environments.",
            "Private provider contracts run separately through the providers command.",
        ],
    }
    write(
        ROOT / "docs/migration/python-modernization-2026-10-03.json",
        json.dumps(report, indent=2) + "\n",
    )


def isolated_distributions(python: str = "3.12") -> None:
    """Build and test every installed wheel without checkout import shadowing."""
    members = load(ROOT / "pyproject.toml")["tool"]["uv"]["workspace"]["members"]
    with tempfile.TemporaryDirectory(prefix="aphrody-distributions-") as temporary:
        work = Path(temporary)
        dist = work / "dist"
        wheels: dict[str, Path] = {}
        for member in members:
            directory = ROOT / member
            project = load(directory / "pyproject.toml")["project"]
            # The SDK wheel uses the pinned Bun-native workspace through its Python
            # backend. This wheel gate retains its existing wheel-only scope.
            wheel_only = ["--wheel"] if project["name"] == "aphrody" else []
            run(
                "uv",
                "build",
                str(directory),
                *wheel_only,
                "--no-sources",
                "--python",
                python,
                "--out-dir",
                str(dist),
            )
            wheel = next(dist.glob(project["name"].replace("-", "_") + "-*.whl"))
            with zipfile.ZipFile(wheel) as archive:
                names = archive.namelist()
                data = email.parser.BytesParser().parsebytes(
                    archive.read(
                        next(
                            name
                            for name in names
                            if name.endswith(".dist-info/METADATA")
                        )
                    )
                )
                expected_license = project.get("license", "Apache-2.0")
                if data.get(
                    "License-Expression"
                ) != expected_license or not data.get_all("License-File"):
                    raise ValueError(f"Incomplete license metadata: {wheel.name}")
                if not any(name.endswith("/py.typed") for name in names):
                    raise ValueError(f"Missing typing marker: {wheel.name}")
                if project["name"] == "aphrody" and any(
                    name.endswith("/entry_points.txt") for name in names
                ):
                    raise ValueError("Core SDK must not install CLI executables")
            wheels[project["name"]] = wheel
        run(
            "uv",
            "run",
            "--no-sync",
            "python",
            str(ROOT / "tools/sdk/verify-wheel.py"),
            str(wheels["aphrody"]),
            "--python",
            python,
            "--tests",
            str(SDK / "tests"),
        )
        for member in members:
            directory = ROOT / member
            project = load(directory / "pyproject.toml")["project"]
            if project["name"] == "aphrody":
                continue
            name = project["name"]
            venv = work / name / "venv"
            run("uv", "venv", "--python", python, str(venv), cwd=work)
            executable = venv / (
                "Scripts/python.exe" if os.name == "nt" else "bin/python"
            )
            dependencies = [
                str(wheels[name]),
                "pytest",
                "pytest-httpx",
                "pytest-asyncio",
            ]
            if name in {"aphrody-cli", "aphrody-meetings"}:
                dependencies.append(str(wheels["aphrody"]))
            if name == "aphrody-train":
                dependencies[0] += "[dedup]"
            if name == "aphrody-cli":
                dependencies.extend(
                    ["Pillow>=12", "pyoxipng>=9.1", "numpy", "networkx"]
                )
            run(
                "uv",
                "pip",
                "install",
                "--python",
                str(executable),
                *dependencies,
                cwd=work,
            )
            imports = load(directory / "pyproject.toml")["tool"]["hatch"]["build"][
                "targets"
            ]["wheel"]["packages"][0].split("/")[-1]
            smoke = f"import importlib, pathlib; module=importlib.import_module({imports!r}); assert pathlib.Path(module.__file__).is_relative_to(pathlib.Path({str(venv)!r}))"
            run(str(executable), "-I", "-c", smoke, cwd=work)
            tests = directory / "tests"
            if tests.exists() and any(tests.glob("test_*.py")):
                isolated = work / name / "tests"
                shutil.copytree(
                    tests,
                    isolated,
                    ignore=shutil.ignore_patterns("__pycache__", ".pytest_cache"),
                )
                if not (isolated / "conftest.py").exists():
                    # shared loopback inference fixtures live in py/conftest.py
                    shutil.copy2(ROOT / "conftest.py", isolated / "conftest.py")
                config = work / name / "pytest.ini"
                write(
                    config,
                    "[pytest]\naddopts = --strict-markers\nmarkers =\n    integration: opt-in services\n    live_api: opt-in authenticated calls\n",
                )
                run(
                    str(executable),
                    "-I",
                    "-m",
                    "pytest",
                    "-c",
                    str(config),
                    "--import-mode=importlib",
                    "-m",
                    "not integration and not live_api",
                    str(isolated),
                    cwd=work,
                )


def linux_sdk(python: str) -> None:
    """Build the Linux SDK wheel from the monorepo and verify it once installed."""
    if not os.uname().sysname == "Linux":
        raise SystemExit("Linux SDK qualification requires a Linux host")
    with tempfile.TemporaryDirectory(prefix="aphrody-linux-sdk-") as temporary:
        work = Path(temporary)
        output = work / "dist"
        run(
            "uv",
            "--no-config",
            "build",
            "--wheel",
            str(SDK),
            "--no-sources",
            "--python",
            python,
            "--out-dir",
            str(output),
            cwd=work,
        )
        wheels = list(output.glob("*.whl"))
        if len(wheels) != 1:
            raise RuntimeError("Expected exactly one SDK wheel")
        wheel = wheels[0]
        run(
            "uv",
            "--no-config",
            "run",
            "--no-sync",
            "--project",
            str(ROOT),
            "python",
            str(ROOT / "tools/sdk/verify-wheel.py"),
            str(wheel),
            "--python",
            python,
            "--tests",
            str(SDK / "tests"),
            cwd=work,
        )
        report = {
            "platform": "linux",
            "architecture": os.uname().machine,
            "python": python,
            "gates": {"installedWheel": "pass"},
            "wheelHashes": {"dist": hashlib.sha256(wheel.read_bytes()).hexdigest()},
        }
        write(
            ROOT / f"docs/migration/linux-sdk-{python}.json",
            json.dumps(report, indent=2) + "\n",
        )


def providers() -> None:
    """Qualify the private pinned fork without replacing the workspace environment."""
    with tempfile.TemporaryDirectory(prefix="aphrody-provider-") as temporary:
        work = Path(temporary)
        venv = work / "venv"
        run("uv", "venv", "--python", "3.12", str(venv))
        executable = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        run("uv", "build", str(SDK), "--wheel", "--no-sources", "--out-dir", str(work))
        wheel = next(work.glob("aphrody-*.whl"))
        run(
            "uv",
            "pip",
            "install",
            "--python",
            str(executable),
            str(wheel) + "[antigravity]",
            "pytest",
            "pytest-httpx",
            "pytest-asyncio",
            cwd=work,
        )
        tests = work / "tests"
        tests.mkdir()
        shutil.copy2(
            SDK / "tests/test_antigravity_bridge.py",
            tests / "test_antigravity_bridge.py",
        )
        config = work / "pytest.ini"
        write(config, "[pytest]\n")
        run(
            str(executable),
            "-I",
            "-c",
            "import importlib.metadata as m, json; "
            "data=json.loads(m.distribution('google-antigravity').read_text('direct_url.json')); "
            f"assert data['url'] == {FORK!r}; "
            f"assert data['vcs_info']['commit_id'] == {PIN!r}",
            cwd=work,
        )
        results = work / "provider-results.xml"
        run(
            str(executable),
            "-I",
            "-m",
            "pytest",
            "-c",
            str(config),
            "--junitxml",
            str(results),
            str(tests),
            cwd=work,
        )
        suites = ET.parse(results).getroot().findall("testsuite")
        assert sum(int(suite.attrib["tests"]) for suite in suites) > 0
        assert all(int(suite.attrib["skipped"]) == 0 for suite in suites)


def locks() -> None:
    """Check the root lock and member locks outside workspace discovery."""
    run("uv", "lock", "--check")
    for directory in (SDK, ROOT / "packages/aphrody-train"):
        with tempfile.TemporaryDirectory(prefix="aphrody-lock-") as temporary:
            staged = Path(temporary) / directory.name
            shutil.copytree(
                directory,
                staged,
                ignore=shutil.ignore_patterns(
                    ".venv",
                    "target",
                    "build",
                    "dist",
                    "__pycache__",
                    ".pytest_cache",
                    ".ruff_cache",
                    "*.so",
                    "*.pyd",
                ),
            )
            run("uv", "lock", "--check", cwd=staged)


def main() -> None:
    """Run the reproducible validation gates."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        choices=["locks", "check", "distributions", "providers", "linux-sdk"],
    )
    parser.add_argument(
        "--python", default="3.12", choices=["3.11", "3.12", "3.13", "3.14"]
    )
    args = parser.parse_args()
    if args.command == "linux-sdk":
        linux_sdk(args.python)
        return
    if args.command == "providers":
        providers()
        return
    if args.command == "distributions":
        isolated_distributions()
        return
    if args.command == "locks":
        locks()
        return
    if args.command == "check":
        locks()
        run(
            "uv",
            "sync",
            "--all-packages",
            "--locked",
            "--extra",
            "rag",
            "--extra",
            "dedup",
        )
        run("uv", "run", "--no-sync", "ruff", "check", ".")
        run("uv", "run", "--no-sync", "ruff", "format", "--check", ".")
        run("uv", "run", "--no-sync", "mypy")
        run("uv", "run", "--no-sync", "pytest")
        isolated_distributions()
        validation_report()
        return
    raise SystemExit(f"unreachable command: {args.command}")


if __name__ == "__main__":
    main()
