# SPDX-License-Identifier: Apache-2.0
"""Build and exercise the native SDK wheel from the Aphrody monorepo checkout.

Run with ``uv run --locked python tools/packaging/qualify_aphrody.py``. The Rust
extension is owned by the pinned Bun fork; the wheel stages its native workspace
outside the Python product checkout, so this gate needs Cargo and belongs on
the serialized build host. The recorded revision is HEAD; `dirty_paths` lists
uncommitted changes under `py/` and the product `rag-core` so unpublished input is
never presented as committed source.
"""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import tomllib
import zipfile
from email.parser import BytesParser
from pathlib import Path

PY_ROOT = Path(__file__).resolve().parents[2]
REPOSITORY = PY_ROOT.parent
PACKAGE = PY_ROOT / "packages/aphrody"
NATIVE_CRATES = ("crates/ai/rag-core",)

NATIVE_SMOKE = """
import importlib.machinery
import json
import math
import struct
from pathlib import Path
import sys
import aphrody.aphrody_rust as native
assert Path(native.__file__).is_relative_to(Path(sys.prefix))
assert any(native.__file__.endswith(s) for s in importlib.machinery.EXTENSION_SUFFIXES)
assert math.isclose(native.cosine_similarity([1., 0.], [1., 0.]), 1.)
assert native.cosine_similarity([1., 0.], [0., 1.]) == 0.
assert native.cosine_similarity([0., 0.], [1., 0.]) == 0.
normalized = native.normalize_embeddings_f64(struct.pack("<4d", 3., 4., 0., 0.), 2, 2)
assert struct.unpack("<4d", normalized) == (0.6, 0.8, 0., 0.)
precise = 1.0 + 1e-10
product = native.embedding_similarities_f64(struct.pack("<d", precise), struct.pack("<d", 1.), 1, 1, 1)
assert struct.unpack("<d", product) == (precise,)
try:
    native.normalize_embeddings_f64(b"bad", 1, 2)
except ValueError:
    pass
else:
    raise AssertionError("packed native dimension validation missing")
try:
    native.cosine_similarity([1.], [1., 0.])
except ValueError:
    pass
else:
    raise AssertionError("native dimension validation missing")
assert native.top_k_cosine_similarity([1., 0.], [[0., 1.], [1., 0.]], 1) == [(1, 1.)]
scores = dict(native.reciprocal_rank_fusion([[0, 1], [1, 0]], 60.))
assert set(scores) == {0, 1}
assert all(math.isclose(score, 1/61 + 1/62, rel_tol=1e-6) for score in scores.values())
from aphrody import AphrodyClient, WebBrowserClient
assert AphrodyClient and WebBrowserClient
from aphrody.jan_adk import AphrodyADK, HostTool
assert AphrodyADK and HostTool
print(json.dumps({"native": Path(native.__file__).name, "native_math": "passed",
                  "public_imports": "passed"}))
"""


def sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def run(args: list[str], cwd: Path, env: dict[str, str]) -> str:
    print("+ " + " ".join(args), flush=True)
    result = subprocess.run(
        args, cwd=cwd, env=env, check=True, text=True, stdout=subprocess.PIPE
    )
    return result.stdout.strip()


def license_inputs(package: Path) -> dict[str, str]:
    """Read exact declared license bytes, rejecting absent/escaping inputs."""
    metadata = tomllib.loads((package / "pyproject.toml").read_text())["project"]
    patterns = metadata.get("license-files")
    if not isinstance(patterns, list) or not patterns:
        raise ValueError("Package must declare nonempty license-files")
    licenses = {}
    for pattern in patterns:
        relative = Path(pattern)
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("License pattern escapes the package")
        matches = list(package.glob(pattern))
        if not matches:
            raise ValueError(f"Missing declared license input: {pattern}")
        for path in matches:
            relative = path.relative_to(package)
            if not path.is_file() or any(
                (package / Path(*relative.parts[:index])).is_symlink()
                for index in range(1, len(relative.parts) + 1)
            ):
                raise ValueError(f"Invalid or symlinked license input: {relative}")
            content = path.read_bytes()
            if not content.strip():
                raise ValueError(f"Empty license input: {relative}")
            licenses[relative.as_posix()] = sha256(content)
    return licenses


def wheel_contents(
    path: Path,
    *,
    licenses: dict[str, str] | None = None,
    license_expression: str | None = None,
) -> dict[str, str]:
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("Wheel contains duplicate members")
        if "aphrody/py.typed" not in names:
            raise ValueError("Wheel lacks the public typing marker")
        if not any(
            name.startswith("aphrody/aphrody_rust.") and name.endswith((".so", ".pyd"))
            for name in names
        ):
            raise ValueError("Wheel lacks the native extension")
        if any(name.startswith(("tests/", "native/", "build/")) for name in names):
            raise ValueError("Wheel contains build or test source")
        record = next(name for name in names if name.endswith(".dist-info/RECORD"))
        rows = list(csv.reader(io.StringIO(archive.read(record).decode())))
        if (
            any(len(row) != 3 for row in rows)
            or len(rows) != len(names)
            or {row[0] for row in rows} != set(names)
        ):
            raise ValueError("Wheel RECORD does not enumerate its members")
        for name, digest, size in rows:
            if name == record and not digest and not size:
                continue
            content = archive.read(name)
            expected = (
                base64.urlsafe_b64encode(hashlib.sha256(content).digest())
                .decode()
                .rstrip("=")
            )
            if digest != f"sha256={expected}" or size != str(len(content)):
                raise ValueError(f"Wheel RECORD integrity failed: {name}")
        hashes = {name: sha256(archive.read(name)) for name in names}
        if licenses is not None or license_expression is not None:
            metadata_names = [
                name for name in names if name.endswith(".dist-info/METADATA")
            ]
            if len(metadata_names) != 1:
                raise ValueError("Wheel must contain exactly one distribution METADATA")
            metadata = BytesParser().parsebytes(archive.read(metadata_names[0]))
            if metadata.get("License-Expression") != license_expression:
                raise ValueError(
                    "Wheel license expression differs from package metadata"
                )
            declared = metadata.get_all("License-File", [])
            if set(declared) != set(licenses or {}) or len(declared) != len(
                set(declared)
            ):
                raise ValueError(
                    "Wheel License-File metadata differs from declared inputs"
                )
            prefix = metadata_names[0].removesuffix("METADATA") + "licenses/"
            for relative, digest in (licenses or {}).items():
                if hashes.get(prefix + relative) != digest:
                    raise ValueError(
                        f"Wheel lacks matching license or notice: {relative}"
                    )
        return hashes


def package_inputs() -> dict[str, str]:
    """Hash the tracked and new first-party files that define the wheel payload."""
    names = (
        subprocess.check_output(
            [
                "git",
                "ls-files",
                "-z",
                "--cached",
                "--others",
                "--exclude-standard",
                "--",
                str(PACKAGE),
                *(str(REPOSITORY / crate) for crate in NATIVE_CRATES),
            ],
            cwd=REPOSITORY,
        )
        .decode()
        .split("\0")
    )
    hashes = {}
    for name in sorted(filter(None, names)):
        path = REPOSITORY / name
        if path.is_file() and not path.is_symlink():
            hashes[name] = sha256(path.read_bytes())
    return hashes


def dirty_paths() -> list[str]:
    status = subprocess.check_output(
        [
            "git",
            "status",
            "--porcelain",
            "--",
            str(PY_ROOT),
            *(str(REPOSITORY / crate) for crate in NATIVE_CRATES),
        ],
        cwd=REPOSITORY,
    ).decode()
    return [line[3:] for line in status.splitlines()]


def qualify(work: Path, python: str, artifacts: Path | None = None) -> dict:
    env = os.environ.copy()
    for name in ("PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV", "UV_PROJECT_ENVIRONMENT"):
        env.pop(name, None)
    env["SOURCE_DATE_EPOCH"] = "1727740800"
    revision = run(["git", "rev-parse", "HEAD"], REPOSITORY, env)
    hashes = package_inputs()
    native = tomllib.loads((PACKAGE / "pyproject.toml").read_text())["tool"]["aphrody"][
        "bun-native"
    ]
    checkout = env.get("APHRODY_BUN_CHECKOUT")
    if not checkout:
        raise RuntimeError("Set APHRODY_BUN_CHECKOUT for native wheel qualification")
    native_archive = subprocess.check_output(
        [
            "git",
            "-C",
            checkout,
            "archive",
            "--format=tar",
            native["revision"],
            native["workspace"],
        ]
    )
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
    licenses = license_inputs(PACKAGE)
    license_expression = tomllib.loads((PACKAGE / "pyproject.toml").read_text())[
        "project"
    ]["license"]
    contents = wheel_contents(
        wheel, licenses=licenses, license_expression=license_expression
    )
    resources = 0
    for relative, digest in hashes.items():
        prefix = (PACKAGE.relative_to(REPOSITORY) / "src/").as_posix() + "/"
        if relative.startswith(prefix + "aphrody/"):
            member = relative.removeprefix(prefix)
            if contents.get(member) != digest:
                raise ValueError(f"Wheel is missing or changes package input: {member}")
            resources += "/resources/" in member
    venv = work / "venv"
    run(["uv", "--no-config", "venv", "--python", python, str(venv)], work, env)
    interpreter = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    run(
        [
            "uv",
            "--no-config",
            "pip",
            "install",
            "--python",
            str(interpreter),
            str(wheel),
        ],
        work,
        env,
    )
    smoke = json.loads(run([str(interpreter), "-I", "-c", NATIVE_SMOKE], work, env))
    if artifacts:
        artifacts.mkdir(parents=True, exist_ok=True)
        shutil.copy2(wheel, artifacts / wheel.name)
    return {
        "schema_version": 2,
        "input_mode": "python-product-with-pinned-bun-native",
        "git_revision": revision,
        "dirty_paths": dirty_paths(),
        "native_crate": native["workspace"] + "/" + native["manifest"],
        "native_source": {**native, "archive_sha256": sha256(native_archive)},
        "input_sha256": hashes,
        "toolchains": {
            "uv": run(["uv", "--version"], work, env),
            "rustc": run(["rustc", "--version"], work, env),
        },
        "wheel_sha256": sha256(wheel.read_bytes()),
        "package_resources_verified": resources,
        "license_expression_verified": license_expression,
        "license_inputs_sha256": licenses,
        "installed_smoke": smoke,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python", default="3.12")
    parser.add_argument("--report", type=Path, help="Write a JSON evidence report")
    parser.add_argument("--artifacts-dir", type=Path, help="Retain the built wheel")
    options = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="aphrody-packaging-") as temporary:
        result = qualify(Path(temporary), options.python, options.artifacts_dir)
    if options.report:
        options.report.parent.mkdir(parents=True, exist_ok=True)
        options.report.write_text(json.dumps(result, indent=2) + "\n")
    print(
        json.dumps(
            {key: value for key, value in result.items() if key != "input_sha256"},
            indent=2,
        )
    )
    if result["dirty_paths"]:
        print(
            "warning: uncommitted input under py/ or the native crates", file=sys.stderr
        )


if __name__ == "__main__":
    main()
