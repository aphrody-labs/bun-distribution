# SPDX-License-Identifier: Apache-2.0
"""Ensure isolated-path normalization cannot conceal dependency changes."""

import csv
import importlib.util
import io
import tarfile
import zipfile
from copy import deepcopy
from pathlib import Path

import pytest

_spec = importlib.util.spec_from_file_location(
    "qualify_aphrody", Path(__file__).with_name("qualify_aphrody.py")
)
assert _spec and _spec.loader
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)
normalize_sbom_source = _module.normalize_sbom_source
_PACKAGE = Path(__file__).resolve().parents[2] / "packages/aphrody"


def bom(source):
    reference = f"path+file://{source}#aphrody-rust@0.1.0"
    return {
        "metadata": {
            "component": {
                "bom-ref": reference,
                "name": "aphrody-rust",
                "version": "0.1.0",
                "components": [{"bom-ref": reference + " bin-target-0"}],
            }
        },
        "components": [
            {
                "bom-ref": "pkg:cargo/pyo3@0.29.0",
                "version": "0.29.0",
                "licenses": [{"license": {"id": "MIT"}}],
            }
        ],
        "dependencies": [{"ref": reference, "dependsOn": ["pkg:cargo/pyo3@0.29.0"]}],
    }


def test_only_local_source_references_may_vary():
    first, second = bom("/tmp/direct/native"), bom("/tmp/rebuild/native")
    original = deepcopy(first)
    assert normalize_sbom_source(first) == normalize_sbom_source(second)
    assert first == original


@pytest.mark.parametrize("change", ["version", "license", "graph"])
def test_dependency_identity_license_and_graph_changes_are_visible(change):
    first, second = bom("/tmp/direct/native"), bom("/tmp/rebuild/native")
    if change == "version":
        second["components"][0]["version"] = "0.30.0"
    elif change == "license":
        second["components"][0]["licenses"][0]["license"]["id"] = "Apache-2.0"
    else:
        second["dependencies"][0]["dependsOn"] = []
    assert normalize_sbom_source(first) != normalize_sbom_source(second)


def test_rejects_different_root_crate_identity():
    source = bom("/tmp/direct/native")
    source["metadata"]["component"]["bom-ref"] += "-replacement"
    with pytest.raises(ValueError, match="source identity"):
        normalize_sbom_source(source)


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


def test_source_layout_payload_is_verified_in_both_wheels_and_sdist(tmp_path):
    inputs = {
        "src/aphrody/jan_adk.py": b"fixture adapter",
        "src/aphrody/resources/fixture.txt": b"fixture resource",
        "LICENSES/AGPL-3.0-only.txt": b"fixture license",
    }
    hashes = {name: _module.sha256(value) for name, value in inputs.items()}
    licenses = {
        name: digest for name, digest in hashes.items() if name.startswith("LICENSES/")
    }
    wheel = {
        name.removeprefix("src/"): digest
        for name, digest in hashes.items()
        if name.startswith("src/")
    }
    sdist = tmp_path / "fixture.tar.gz"
    with tarfile.open(sdist, "w:gz") as archive:
        for name, value in inputs.items():
            member = tarfile.TarInfo("aphrody-0.1.0/" + name)
            member.size = len(value)
            archive.addfile(member, io.BytesIO(value))
    assert (
        _module.verify_package_payload(
            hashes, (wheel, wheel), sdist, "aphrody-0.1.0", licenses
        )
        == 1
    )
    changed = {**wheel, "aphrody/jan_adk.py": "incorrect"}
    with pytest.raises(ValueError, match="package input"):
        _module.verify_package_payload(
            hashes, (wheel, changed), sdist, "aphrody-0.1.0", licenses
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


def test_worktree_snapshot_includes_new_python_and_license_inputs_not_runtime_data(
    tmp_path, monkeypatch
):
    source = tmp_path / "source"
    package = source / _module.PACKAGE
    package.parent.mkdir(parents=True)
    package_inputs(package)
    for name in _module.UNTRACKED_INPUTS:
        path = package / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"synthetic build input")
    module = package / "src/aphrody/yolo_runtime.py"
    module.write_text('"""synthetic first-party runtime binding"""\n')
    (module.parent / "protected-fixture.db").write_bytes(b"fixture not package source")
    monkeypatch.setattr(
        _module.subprocess,
        "check_output",
        lambda args, **kwargs: (
            b"" if "--deleted" in args else b"packages/aphrody/pyproject.toml\0"
        ),
    )
    destination = tmp_path / "snapshot"
    hashes = _module.snapshot(source, destination)
    assert hashes["src/aphrody/yolo_runtime.py"] == _module.sha256(module.read_bytes())
    assert "LICENSES/AGPL-3.0-only.txt" in hashes
    assert not (destination / "src/aphrody/protected-fixture.db").exists()
