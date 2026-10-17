# SPDX-License-Identifier: Apache-2.0
"""Wheel license, notice and native-extension checks of the qualification gate."""

import csv
import importlib.util
import io
import zipfile
from pathlib import Path

import pytest

_spec = importlib.util.spec_from_file_location(
    "qualify_aphrody", Path(__file__).with_name("qualify_aphrody.py")
)
assert _spec and _spec.loader
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)
_PACKAGE = Path(__file__).resolve().parents[2] / "packages/aphrody"


def test_maturin_builds_the_workspace_crate_in_place():
    import tomllib

    metadata = tomllib.loads((_PACKAGE / "pyproject.toml").read_text())
    assert metadata["build-system"]["build-backend"] == "maturin"
    maturin = metadata["tool"]["maturin"]
    assert maturin["locked"] is True
    manifest = (_PACKAGE / maturin["manifest-path"]).resolve()
    assert manifest == _module.REPOSITORY / _module.NATIVE_CRATES[0] / "Cargo.toml"
    crate = tomllib.loads(manifest.read_text())
    assert crate["package"]["name"] == "aphrody-rust"
    assert maturin["module-name"] == "aphrody." + crate["lib"]["name"]
    assert "abi3-py311" in crate["dependencies"]["pyo3"]["features"]
    assert "bun-native" not in metadata["tool"].get("aphrody", {})


def package_inputs(root):
    root.mkdir()
    (root / "LICENSES").mkdir()
    (root / "pyproject.toml").write_text(
        '[project]\nlicense="Apache-2.0 AND AGPL-3.0-only"\n'
        'license-files=["LICENSE", "NOTICE", "LICENSES/AGPL-3.0-only.txt"]\n'
    )
    for name in ("LICENSE", "NOTICE", "LICENSES/AGPL-3.0-only.txt"):
        (root / name).write_text("synthetic license fixture: " + name)
    return _module.license_inputs(root)


def fixture_wheel(
    path,
    licenses,
    *,
    extension=True,
    expression="Apache-2.0 AND AGPL-3.0-only",
    change_license=False,
):
    contents = {
        "aphrody/py.typed": b"",
        "aphrody/aphrody_rust.fixture.so"
        if extension
        else "aphrody/aphrody_rust.pyi": b"synthetic; not a runnable native extension",
        "aphrody/jan_adk.py": b"synthetic adapter",
        "aphrody-0.1.0.dist-info/METADATA": (
            "Metadata-Version: 2.4\nName: aphrody\nVersion: 0.1.0\n"
            "License-Expression: "
            + expression
            + "\n"
            + "".join("License-File: " + name + "\n" for name in licenses)
            + "\n"
        ).encode(),
    }
    for name in licenses:
        contents["aphrody-0.1.0.dist-info/licenses/" + name] = (
            "synthetic license fixture: " + name
        ).encode()
    if change_license:
        contents["aphrody-0.1.0.dist-info/licenses/LICENSE"] = b"changed license"
    rows = []
    import base64
    import hashlib

    for name, value in contents.items():
        digest = (
            base64.urlsafe_b64encode(hashlib.sha256(value).digest())
            .decode()
            .rstrip("=")
        )
        rows.append([name, "sha256=" + digest, str(len(value))])
    record = "aphrody-0.1.0.dist-info/RECORD"
    rows.append([record, "", ""])
    output = io.StringIO(newline="")
    csv.writer(output).writerows(rows)
    contents[record] = output.getvalue().encode()
    with zipfile.ZipFile(path, "w") as wheel:
        for name, value in contents.items():
            wheel.writestr(name, value)
    return contents


def test_manifest_license_patterns_require_real_nonempty_inputs(tmp_path):
    package = tmp_path / "package"
    licenses = package_inputs(package)
    assert set(licenses) == {"LICENSE", "NOTICE", "LICENSES/AGPL-3.0-only.txt"}
    (package / "NOTICE").unlink()
    with pytest.raises(ValueError, match="Missing declared license"):
        _module.license_inputs(package)
    (package / "NOTICE").write_text(" ")
    with pytest.raises(ValueError, match="Empty license"):
        _module.license_inputs(package)


@pytest.mark.parametrize(
    "fault,message",
    [
        ("stub", "native extension"),
        ("expression", "expression"),
        ("license_bytes", "matching license"),
    ],
)
def test_wheel_license_metadata_and_actual_extension_are_enforced(
    tmp_path, fault, message
):
    licenses = package_inputs(tmp_path / "package")
    path = tmp_path / "fixture.whl"
    fixture_wheel(
        path,
        licenses,
        extension=fault != "stub",
        expression="Apache-2.0"
        if fault == "expression"
        else "Apache-2.0 AND AGPL-3.0-only",
        change_license=fault == "license_bytes",
    )
    with pytest.raises(ValueError, match=message):
        _module.wheel_contents(
            path, licenses=licenses, license_expression="Apache-2.0 AND AGPL-3.0-only"
        )


def test_actual_package_license_metadata_matches_component_notices():
    import tomllib

    metadata = tomllib.loads((_PACKAGE / "pyproject.toml").read_text())["project"]
    assert metadata["license"] == "Apache-2.0 AND AGPL-3.0-only"
    licenses = _module.license_inputs(_PACKAGE)
    assert "LICENSES/AGPL-3.0-only.txt" in licenses
    notice = (_PACKAGE / "NOTICE").read_text()
    assert "14a720628f9592c8e60f7e081ef733076db8a6a9" in notice
    assert "AGPL-3.0" in notice
    adapter = (_PACKAGE / "src/aphrody/jan_adk.py").read_text()
    assert "SPDX-License-Identifier: AGPL-3.0-only" in adapter
