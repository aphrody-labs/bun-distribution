# SPDX-License-Identifier: Apache-2.0
"""Build and exercise the native SDK outside its development workspace.

Run with ``uv run --locked python tools/packaging/qualify_aphrody.py``.
The default input is committed Git source; --worktree explicitly qualifies a
snapshot of concurrent, unpublished packaging changes instead.
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
import tarfile
import tempfile
import tomllib
import zipfile
from email.parser import BytesParser
from pathlib import Path

REPOSITORY = Path(__file__).resolve().parents[2]
PACKAGE = Path("packages/aphrody")
UNTRACKED_INPUTS = {
    "build_backend.py",
    "src/aphrody/py.typed",
    "native/Cargo.toml",
    "native/Cargo.lock",
    "native/source.json",
    "native/source.tar.gz",
}
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


def snapshot(source: Path, destination: Path) -> dict[str, str]:
    names = (
        subprocess.check_output(
            ["git", "ls-files", "-z", "--", str(PACKAGE)], cwd=source
        )
        .decode()
        .split("\0")
    )
    paths = {Path(name).relative_to(PACKAGE) for name in names if name}
    deleted = (
        subprocess.check_output(
            ["git", "ls-files", "--deleted", "-z", "--", str(PACKAGE)], cwd=source
        )
        .decode()
        .split("\0")
    )
    paths.difference_update(Path(name).relative_to(PACKAGE) for name in deleted if name)
    paths.update(Path(name) for name in UNTRACKED_INPUTS)
    paths.update(Path(name) for name in license_inputs(source / PACKAGE))
    # Worktree qualification must include new first-party modules as well as
    # tracked ones. Restrict this to source/typing files, never runtime data.
    python_source = source / PACKAGE / "src/aphrody"
    for pattern in ("**/*.py", "**/*.pyi", "**/py.typed"):
        paths.update(
            path.relative_to(source / PACKAGE)
            for path in python_source.glob(pattern)
            if path.is_file()
        )
    for name in ("src/aphrody/aphrody_rust.pyi", "LICENSE", "NOTICE"):
        if (source / PACKAGE / name).is_file():
            paths.add(Path(name))
    # Redistributable package data is explicit; secrets and generated native
    # source never enter this unpublished-source staging allowlist.
    resources = source / PACKAGE / "src/aphrody/resources"
    if resources.exists():
        paths.update(
            path.relative_to(source / PACKAGE)
            for path in resources.rglob("*")
            if path.is_file()
        )
    hashes = {}
    for relative in sorted(paths):
        original = source / PACKAGE / relative
        if not original.is_file() or original.is_symlink():
            raise ValueError(f"Missing or symlinked packaging input: {relative}")
        content = original.read_bytes()
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        hashes[str(relative)] = sha256(content)
    for name, digest in hashes.items():
        if sha256((source / PACKAGE / name).read_bytes()) != digest:
            raise ValueError(f"Source changed during snapshot: {name}; retry")
    return hashes


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


def verify_package_payload(
    inputs: dict[str, str],
    wheels: tuple[dict[str, str], dict[str, str]],
    sdist: Path,
    prefix: str,
    licenses: dict[str, str],
) -> int:
    """Compare source-layout inputs with wheel-layout members and sdist bytes."""
    resources = 0
    with tarfile.open(sdist) as archive:
        members = archive.getnames()
        if len(members) != len(set(members)):
            raise ValueError("Sdist contains duplicate members")
        for relative, digest in inputs.items():
            if relative.startswith("src/aphrody/"):
                wheel_member = relative.removeprefix("src/")
                if any(wheel.get(wheel_member) != digest for wheel in wheels):
                    raise ValueError(
                        f"Wheel is missing or changes package input: {relative}"
                    )
                resources += relative.startswith("src/aphrody/resources/")
            elif relative not in licenses:
                continue
            try:
                member = archive.getmember(f"{prefix}/{relative}")
            except KeyError as error:
                raise ValueError(f"Sdist lacks package input: {relative}") from error
            if not member.isfile():
                raise ValueError(
                    f"Sdist package input is not a regular file: {relative}"
                )
            source = archive.extractfile(member)
            if source is None or sha256(source.read()) != digest:
                raise ValueError(
                    f"Sdist is missing or changes package input: {relative}"
                )
    return resources


def json_differences(first, second, path="") -> list[str]:
    """Describe metadata drift without copying local paths into public logs."""
    if isinstance(first, dict) and isinstance(second, dict):
        differences = []
        for key in sorted(first.keys() | second.keys()):
            child = f"{path}/{key}"
            if key not in first or key not in second:
                differences.append(child)
            else:
                differences.extend(json_differences(first[key], second[key], child))
        return differences
    if isinstance(first, list) and isinstance(second, list):
        if len(first) != len(second):
            return [path]
        return [
            child
            for index, (a, b) in enumerate(zip(first, second, strict=True))
            for child in json_differences(a, b, f"{path}/{index}")
        ]
    return [] if first == second else [path]


def normalize_sbom_source(sbom: dict) -> dict:
    """Normalize only references to this isolated Cargo source directory.

    Full dependency versions, licenses, hashes, graph edges and root crate
    identity must remain equal. Original SBOM bytes stay in both distributions.
    """
    reference = sbom["metadata"]["component"]["bom-ref"]
    prefix, identity = reference.rsplit("#", 1)
    if not prefix.startswith("path+file://") or identity != "aphrody-rust@0.1.0":
        raise ValueError("Unexpected local source identity in Rust SBOM")

    def normalize(value):
        if isinstance(value, dict):
            result = {}
            for key, item in value.items():
                if (
                    key in {"bom-ref", "ref"}
                    and isinstance(item, str)
                    and (
                        item == reference or item.startswith(reference + " bin-target-")
                    )
                ):
                    item = f"isolated-native-source#{identity}" + item[len(reference) :]
                result[key] = normalize(item)
            return result
        if isinstance(value, list):
            return [normalize(item) for item in value]
        return value

    return normalize(sbom)


def qualify(
    work: Path, worktree: bool, python: str, artifacts: Path | None = None
) -> dict:
    env = os.environ.copy()
    for name in ("PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV", "UV_PROJECT_ENVIRONMENT"):
        env.pop(name, None)
    env["SOURCE_DATE_EPOCH"] = "1727740800"
    revision = run(["git", "rev-parse", "HEAD"], REPOSITORY, env)
    source = REPOSITORY
    if not worktree:
        source = work / "clone"
        run(
            ["git", "clone", "--quiet", "--no-hardlinks", str(REPOSITORY), str(source)],
            work,
            env,
        )
        # A concurrent source commit may land while cloning; record the revision
        # actually copied into this immutable clone rather than its earlier HEAD.
        revision = run(["git", "rev-parse", "HEAD"], source, env)
    stage = work / "package"
    hashes = snapshot(source, stage)
    # Build directories and Cargo targets are independent for each build.
    direct = work / "direct"
    run(
        [
            "uv",
            "--no-config",
            "build",
            "--wheel",
            "--python",
            python,
            "--out-dir",
            str(direct),
            str(stage),
        ],
        work,
        env,
    )
    run(
        [
            "uv",
            "--no-config",
            "build",
            "--sdist",
            "--python",
            python,
            "--out-dir",
            str(direct),
            str(stage),
        ],
        work,
        env,
    )
    sdist = next(direct.glob("*.tar.gz"))
    first = next(direct.glob("*.whl"))
    with tarfile.open(sdist) as archive:
        names = set(archive.getnames())
    prefix = sdist.name.removesuffix(".tar.gz")
    for name in (
        "build_backend.py",
        "native/Cargo.toml",
        "native/Cargo.lock",
        "native/source.json",
        "native/source.tar.gz",
    ):
        if f"{prefix}/{name}" not in names:
            raise ValueError(f"Sdist lacks pinned build input: {name}")
    rebuilt = work / "rebuilt"
    run(
        [
            "uv",
            "--no-config",
            "build",
            "--python",
            python,
            "--wheel",
            "--out-dir",
            str(rebuilt),
            str(sdist),
        ],
        work,
        env,
    )
    second = next(rebuilt.glob("*.whl"))
    licenses = license_inputs(stage)
    license_expression = tomllib.loads((stage / "pyproject.toml").read_text())[
        "project"
    ]["license"]
    first_contents, second_contents = (
        wheel_contents(wheel, licenses=licenses, license_expression=license_expression)
        for wheel in (first, second)
    )
    changed = sorted(
        name
        for name in first_contents.keys() | second_contents.keys()
        if first_contents.get(name) != second_contents.get(name)
    )
    sbom_differences = {}
    equivalent_sboms = True
    with zipfile.ZipFile(first) as a, zipfile.ZipFile(second) as b:
        for name in changed:
            if ".dist-info/sboms/" in name and name.endswith(".json"):
                first_sbom, second_sbom = (
                    json.loads(a.read(name)),
                    json.loads(b.read(name)),
                )
                sbom_differences[name] = json_differences(first_sbom, second_sbom)
                equivalent_sboms &= normalize_sbom_source(
                    first_sbom
                ) == normalize_sbom_source(second_sbom)
    payload_equivalent = equivalent_sboms and all(
        name.endswith(".dist-info/RECORD") or name in sbom_differences
        for name in changed
    )
    resource_count = verify_package_payload(
        hashes, (first_contents, second_contents), sdist, prefix, licenses
    )
    smokes = []
    for label, wheel in (("direct", first), ("sdist-rebuild", second)):
        venv = work / f"venv-{label}"
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
        smokes.append(
            json.loads(run([str(interpreter), "-I", "-c", NATIVE_SMOKE], work, env))
        )
    if artifacts:
        for label, artifact in (
            ("direct", first),
            ("direct", sdist),
            ("rebuilt", second),
        ):
            target = artifacts / label / artifact.name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(artifact, target)
    return {
        "schema_version": 1,
        "input_mode": "worktree-snapshot" if worktree else "committed-clean-clone",
        "python_git_revision": revision,
        "native_provenance": json.loads((stage / "native/source.json").read_text()),
        "input_sha256": hashes,
        "toolchains": {
            "uv": run(["uv", "--version"], work, env),
            "rustc": run(["rustc", "--version"], work, env),
        },
        "sdist_sha256": sha256(sdist.read_bytes()),
        "wheel_sha256": sha256(first.read_bytes()),
        "rebuilt_wheel_sha256": sha256(second.read_bytes()),
        "wheel_members_identical": not changed,
        "differing_wheel_members": changed,
        "sbom_differing_json_paths": sbom_differences,
        "wheel_payload_and_provenance_equivalent": payload_equivalent,
        "sbom_allowed_nondeterminism": "Isolated Cargo source path in local bom-ref/ref values only",
        "package_resources_verified": resource_count,
        "license_expression_verified": license_expression,
        "license_inputs_sha256": licenses,
        "wheel_bytes_identical": first.read_bytes() == second.read_bytes(),
        "installed_smokes": smokes,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--worktree", action="store_true", help="Qualify unpublished input explicitly"
    )
    parser.add_argument("--python", default="3.12")
    parser.add_argument("--report", type=Path, help="Write a JSON evidence report")
    parser.add_argument(
        "--artifacts-dir", type=Path, help="Retain the built distributions"
    )
    parser.add_argument(
        "--require-byte-reproducibility",
        action="store_true",
        help="Also require byte-identical wheel archives",
    )
    options = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="aphrody-packaging-") as temporary:
        result = qualify(
            Path(temporary), options.worktree, options.python, options.artifacts_dir
        )
    if options.report:
        options.report.parent.mkdir(parents=True, exist_ok=True)
        options.report.write_text(json.dumps(result, indent=2) + "\n")
    print(
        json.dumps(
            {key: value for key, value in result.items() if key != "input_sha256"},
            indent=2,
        )
    )
    if not result["wheel_payload_and_provenance_equivalent"]:
        sys.exit(
            "Wheel payload or dependency provenance differs across isolated builds"
        )
    if options.require_byte_reproducibility and not result["wheel_bytes_identical"]:
        sys.exit("Reproducibility gate failed; inspect the reported wheel differences")


if __name__ == "__main__":
    main()
