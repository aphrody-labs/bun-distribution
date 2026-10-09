# SPDX-License-Identifier: Apache-2.0
"""Install locked SDK extras independently and run their existing contracts.

Inputs come from the Aphrody monorepo checkout (HEAD revision recorded, uncommitted
paths listed). Tests exercise the installed wheel outside the checkout; absent
dependencies cannot turn into skips. The wheel uses the pinned Bun native adapter, so this
gate needs Cargo and runs on the serialized build host.
These local checks do not claim authenticated services, models or GPU parity.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

from qualify_aphrody import (
    NATIVE_SMOKE,
    PACKAGE,
    PY_ROOT,
    REPOSITORY,
    dirty_paths,
    package_inputs,
    wheel_contents,
)

PROFILES = {
    "images": ("test_images.py", "test_optimize.py"),
    "icons": ("test_icons.py",),
    "to3d": ("test_to3d.py",),
    "antigravity": ("test_antigravity_bridge.py",),
    "rag": ("test_rag_math.py", "test_rag_pipeline.py", "test_rag_cli.py"),
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(args: list[str], cwd: Path, env: dict[str, str], *, check=True):
    print("+ " + " ".join(args), flush=True)
    result = subprocess.run(
        args,
        cwd=cwd,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    if check and result.returncode:
        raise RuntimeError(result.stdout)
    return result


def qualify(work: Path, extras: list[str], python: str) -> dict:
    env = os.environ.copy()
    for name in ("PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV", "UV_PROJECT_ENVIRONMENT"):
        env.pop(name, None)
    env["SOURCE_DATE_EPOCH"] = "1727740800"
    clone = PY_ROOT
    revision = run(["git", "rev-parse", "HEAD"], REPOSITORY, env).stdout.strip()
    inputs = package_inputs()
    dist = work / "dist"
    run(
        [
            "uv",
            "--no-config",
            "build",
            "--wheel",
            "--python",
            python,
            "--out-dir",
            str(dist),
            str(PACKAGE),
        ],
        work,
        env,
    )
    wheel = next(dist.glob("aphrody-*.whl"))
    wheel_contents(wheel)
    peer = None
    if "antigravity" in extras:
        # The workspace lock chooses this upstream member, so attest its own
        # wheel instead of accidentally falling back to a different PyPI build.
        run(
            [
                "uv",
                "build",
                "--wheel",
                "--package",
                "google-antigravity",
                "--python",
                python,
                "--out-dir",
                str(dist),
            ],
            clone,
            env,
        )
        peer = next(dist.glob("google_antigravity-*.whl"))
    report = {
        "schema_version": 1,
        "input_mode": "monorepo-in-place",
        "git_revision": revision,
        "dirty_paths": dirty_paths(),
        "input_sha256": inputs,
        "uv_lock_sha256": digest(clone / "uv.lock"),
        "sdk_wheel_sha256": digest(wheel),
        "upstream_antigravity_wheel_sha256": digest(peer) if peer else None,
        "profiles": {},
        "unqualified": [
            "Authenticated/network provider integration",
            "Depth/model, Docling/model-runtime, voice and forensic extras",
            "CUDA, Windows/macOS and release-set installation",
            "Antigravity PyPI replacement for the pinned workspace source",
        ],
    }
    resources = {
        str(path.relative_to(PACKAGE / "src/aphrody")): digest(path)
        for path in (PACKAGE / "src/aphrody/resources").rglob("*")
        if path.is_file()
    }
    for extra in extras:
        profile = work / extra
        profile.mkdir()
        result = {}
        report["profiles"][extra] = result
        try:
            requirements = profile / "requirements.txt"
            run(
                [
                    "uv",
                    "export",
                    "--locked",
                    "--package",
                    "aphrody",
                    "--extra",
                    extra,
                    "--no-default-groups",
                    "--group",
                    "dev",
                    "--no-emit-local",
                    "--no-header",
                    "--no-annotate",
                    "--output-file",
                    str(requirements),
                ],
                clone,
                env,
            )
            result["requirements_sha256"] = digest(requirements)
            venv = profile / "venv"
            run(
                ["uv", "--no-config", "venv", "--python", python, str(venv)],
                profile,
                env,
            )
            interpreter = venv / (
                "Scripts/python.exe" if os.name == "nt" else "bin/python"
            )
            run(
                [
                    "uv",
                    "--no-config",
                    "pip",
                    "install",
                    "--python",
                    str(interpreter),
                    "--require-hashes",
                    "-r",
                    str(requirements),
                ],
                profile,
                env,
            )
            wheels = [str(wheel)]
            if extra == "antigravity":
                wheels.append(str(peer))
            run(
                [
                    "uv",
                    "--no-config",
                    "pip",
                    "install",
                    "--python",
                    str(interpreter),
                    "--no-deps",
                    *wheels,
                ],
                profile,
                env,
            )
            run(
                ["uv", "--no-config", "pip", "check", "--python", str(interpreter)],
                profile,
                env,
            )
            installed = run(
                [
                    str(interpreter),
                    "-I",
                    "-c",
                    """
import hashlib, importlib.metadata, importlib.resources, json, sys
from pathlib import Path
import aphrody
assert Path(aphrody.__file__).is_relative_to(Path(sys.prefix))
expected = json.loads(sys.argv[1])
for name, sha in expected.items():
    data = importlib.resources.files('aphrody').joinpath(name).read_bytes()
    assert hashlib.sha256(data).hexdigest() == sha, name
print(json.dumps({d.metadata['Name']: d.version
                  for d in importlib.metadata.distributions()}, sort_keys=True))
""",
                    json.dumps(resources),
                ],
                profile,
                env,
            )
            result["installed_distributions"] = json.loads(installed.stdout)
            run([str(interpreter), "-I", "-c", NATIVE_SMOKE], profile, env)
            result["installed_native_math"] = "passed"
            tests = []
            result["test_input_sha256"] = {}
            for name in PROFILES[extra]:
                source = PACKAGE / "tests" / name
                target = profile / name
                shutil.copyfile(source, target)
                tests.append(str(target))
                result["test_input_sha256"][name] = digest(target)
            junit = profile / "junit.xml"
            test_run = run(
                [
                    str(interpreter),
                    "-I",
                    "-m",
                    "pytest",
                    "-q",
                    *tests,
                    "--junitxml",
                    str(junit),
                ],
                profile,
                env,
                check=False,
            )
            print(test_run.stdout, flush=True)
            suite = ET.parse(junit).getroot().find("testsuite")
            if suite is None:
                raise ValueError("No contract test result produced")
            result["tests"] = {
                key: int(suite.attrib.get(key, "0"))
                for key in ("tests", "failures", "errors", "skipped")
            }
            counts = result["tests"]
            result["passed"] = bool(
                not test_run.returncode
                and counts["tests"] > 0
                and not any(counts[k] for k in ("failures", "errors", "skipped"))
            )
            result["installed_outside_checkout"] = True
            result["packaged_resources_verified"] = len(resources)
        except (RuntimeError, ValueError, OSError) as error:
            result["passed"] = False
            result["error"] = str(error)
            print(f"{extra} failed: {error}", flush=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--extra", action="append", choices=PROFILES)
    parser.add_argument("--python", default="3.12")
    parser.add_argument("--report", type=Path, required=True)
    options = parser.parse_args()
    with tempfile.TemporaryDirectory(
        prefix="aphrody-extras-qualification-"
    ) as temporary:
        report = qualify(
            Path(temporary), options.extra or list(PROFILES), options.python
        )
    options.report.parent.mkdir(parents=True, exist_ok=True)
    options.report.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report["profiles"], indent=2))
    if not all(profile["passed"] for profile in report["profiles"].values()):
        raise SystemExit("Extra qualification failed; see actual contract results")


if __name__ == "__main__":
    main()
