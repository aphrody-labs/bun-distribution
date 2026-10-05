#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Check an Aphrody wheel in a fresh environment, outside its source checkout.

Only the standard library is needed to run this driver; uv installs the wheel's
declared dependencies and the focused test dependencies in a temporary venv.
"""

from __future__ import annotations

import argparse
import email.parser
import json
import os
import re
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

SOURCE_ONLY_TESTS = {"test_public_api.py"}
BLENDER_RESOURCES = (
    "_bl_common.py",
    "gpu_render.py",
    "multiview_turntable.py",
    "optimize_glb.py",
    "sprite_to_3d.py",
)

SMOKE = r"""
import importlib.metadata
import importlib.resources
import json
import math
from pathlib import Path
import sys

import aphrody
assert 'WebBrowserClient' in dir(aphrody)
assert 'WebBrowserClient' not in vars(aphrody), 'SDK exports eagerly loaded'
assert not any(name.split('.')[0] in {'httpx', 'google', 'scrapy', 'torch'}
               for name in sys.modules), 'root import loaded provider dependencies'
root = Path(aphrody.__file__).resolve()
assert root.is_relative_to(Path(sys.prefix).resolve()), root
assert aphrody.__version__ == importlib.metadata.version('aphrody')
from aphrody import ActorClient, WebBrowserClient
assert callable(ActorClient) and callable(WebBrowserClient)
import aphrody.aphrody_rust as native
assert Path(native.__file__).resolve().is_relative_to(Path(sys.prefix).resolve())
assert math.isclose(native.cosine_similarity([1., 0.], [1., 0.]), 1.)
assert native.top_k_cosine_similarity([1., 0.], [[0., 1.], [1., 0.]], 1) == [(1, 1.)]
assert native.reciprocal_rank_fusion([[2, 1], [2, 3]])[0][0] == 2
assert importlib.resources.files('aphrody').joinpath('py.typed').is_file()
print(json.dumps({'version': aphrody.__version__, 'installed': str(root),
                  'native': str(native.__file__)}))
"""


def inspect_wheel(wheel: Path) -> str:
    """Reject incomplete, source-only, or checkout-dependent distributions."""
    if not wheel.is_file() or wheel.suffix != ".whl":
        raise ValueError(f"Expected an existing wheel: {wheel}")
    if "-cp311-abi3-" not in wheel.name:
        raise ValueError(f"Expected a CPython 3.11 stable ABI wheel: {wheel.name}")
    with zipfile.ZipFile(wheel) as archive:
        members = set(archive.namelist())
        required = {
            "aphrody/py.typed",
            "aphrody/__init__.py",
            "aphrody/aphrody_rust.pyi",
        }
        required.update(
            f"aphrody/resources/blender/{name}" for name in BLENDER_RESOURCES
        )
        missing = required - members
        if missing:
            raise ValueError(f"Wheel is missing SDK resources: {sorted(missing)}")
        sboms = [
            name
            for name in members
            if name.endswith(".dist-info/sboms/aphrody-rust.cyclonedx.json")
        ]
        if len(sboms) != 1:
            raise ValueError("Wheel must carry the aphrody-rust CycloneDX SBOM")
        component = json.loads(archive.read(sboms[0]))["metadata"]["component"]
        if component.get("name") != "aphrody-rust":
            raise ValueError("The SBOM must describe the aphrody-rust crate")
        native = [
            name
            for name in members
            if name.startswith("aphrody/aphrody_rust")
            and name.endswith((".so", ".pyd"))
        ]
        if len(native) != 1:
            raise ValueError(f"Expected one native extension, found {native}")
        metadata_files = [
            name for name in members if name.endswith(".dist-info/METADATA")
        ]
        if len(metadata_files) != 1:
            raise ValueError("Expected exactly one wheel metadata file")
        license_file = metadata_files[0].removesuffix("METADATA") + "licenses/LICENSE"
        if license_file not in members or b"Apache License" not in archive.read(
            license_file
        ):
            raise ValueError("Wheel must carry its Apache license text")
        metadata = email.parser.BytesParser().parsebytes(
            archive.read(metadata_files[0])
        )
        if metadata["Name"] != "aphrody":
            raise ValueError(f"Unexpected distribution: {metadata['Name']}")
        for requirement in metadata.get_all("Requires-Dist", []):
            if " @ " in requirement and not re.fullmatch(
                "google-antigravity(?:\\[voice\\])?\\s*@\\s*git\\+https://github\\.com/aphrody\\-labs/antigravity\\-sdk\\-python\\.git@02fa7fa362d815f788074ae09998041b34f9a770\\s*;\\s*extra\\s*==\\s*['\\\"](?:voice|antigravity)['\\\"]",
                requirement,
                re.IGNORECASE,
            ):
                raise ValueError(f"Non-registry runtime dependency: {requirement}")
            if (
                requirement.lower().startswith("scrapy")
                and "extra ==" not in requirement
            ):
                raise ValueError("Scrapy is not a core SDK runtime dependency")
        version = metadata["Version"]
        if not version:
            raise ValueError("Missing distribution version")
        return version


def run(command: list[str], *, cwd: Path, env: dict[str, str]) -> None:
    subprocess.run(command, cwd=cwd, env=env, check=True, timeout=600)


def verify(wheel: Path, python: str, tests: Path | None) -> None:
    version = inspect_wheel(wheel)
    uv = shutil.which("uv")
    if uv is None:
        raise RuntimeError("uv must be installed to create the isolated environment")
    env = dict(os.environ)
    for name in (
        "PYTHONPATH",
        "VIRTUAL_ENV",
        "APHRODY_RUN_INTEGRATION_TESTS",
        "APHRODY_TEST_BINARY",
        "GEMINI_COOKIES",
        "GOOGLE_COOKIES",
    ):
        env.pop(name, None)
    env["PYTEST_DISABLE_PLUGIN_AUTOLOAD"] = "1"
    with tempfile.TemporaryDirectory(prefix="aphrody-wheel-") as temporary:
        work = Path(temporary)
        env["APHRODY_HOME"] = str(work / "state")
        env["APHRODY_SECRETS_DIR"] = str(work / "secrets")
        env["APHRODY_CACHE_DIR"] = str(work / "cache")
        env["BXC_COOKIES_DIR"] = str(work / "cookies")
        venv = work / "venv"
        interpreter = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        run(
            [uv, "--no-config", "venv", "--python", python, str(venv)],
            cwd=work,
            env=env,
        )
        dependencies = [str(wheel)]
        if tests is not None:
            dependencies.extend(
                [
                    "pytest>=8.3",
                    "pytest-httpx>=0.35",
                    "pytest-asyncio>=0.23",
                    "numpy>=1.26",
                    "Pillow>=12.0",
                    "pyoxipng>=9.1",
                ]
            )
        run(
            [
                uv,
                "--no-config",
                "pip",
                "install",
                "--python",
                str(interpreter),
                *dependencies,
            ],
            cwd=work,
            env=env,
        )
        run([str(interpreter), "-I", "-c", SMOKE], cwd=work, env=env)
        if tests is not None:
            isolated_tests = work / "tests"
            isolated_tests.mkdir()
            test_files = sorted(tests.glob("test_*.py"))
            if not test_files:
                raise ValueError(f"No SDK tests found in {tests}")
            for source in test_files:
                if source.name not in SOURCE_ONLY_TESTS:
                    shutil.copy2(source, isolated_tests / source.name)
            # The workspace conftest only defines loopback inference fixtures (no imports
            # of the source tree), which the copied tests need; copy it next to them.
            fixtures = tests.parents[2] / "conftest.py"
            if fixtures.is_file():
                shutil.copy2(fixtures, isolated_tests / "conftest.py")
            config = work / "pytest.ini"
            config.write_text(
                "[pytest]\naddopts = --strict-markers\n"
                "markers =\n"
                "    integration: opt-in runtimes, models or services\n"
                "    live_api: opt-in authenticated provider calls\n",
                encoding="utf-8",
            )
            run(
                [
                    str(interpreter),
                    "-I",
                    "-m",
                    "pytest",
                    "-p",
                    "pytest_httpx",
                    "-p",
                    "pytest_asyncio.plugin",
                    "-c",
                    str(config),
                    "--import-mode=importlib",
                    "-m",
                    "not integration and not live_api",
                    "-q",
                    "-rs",
                    str(isolated_tests),
                ],
                cwd=work,
                env=env,
            )
    print(json.dumps({"wheel": wheel.name, "version": version, "verified": True}))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wheel", type=Path)
    parser.add_argument(
        "--python", default="3.12", help="Interpreter for the fresh venv"
    )
    parser.add_argument(
        "--tests", type=Path, help="SDK test directory to copy into isolation"
    )
    args = parser.parse_args()
    verify(
        args.wheel.resolve(), args.python, args.tests.resolve() if args.tests else None
    )


if __name__ == "__main__":
    main()
