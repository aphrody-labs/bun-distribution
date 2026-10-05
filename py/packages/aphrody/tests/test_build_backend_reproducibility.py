# SPDX-License-Identifier: Apache-2.0
"""Native provenance preservation and exact wheel RECORD regeneration."""

import csv
import hashlib
import importlib.util
import io
import json
import zipfile
from copy import deepcopy
from pathlib import Path

import pytest

_PACKAGE = Path(__file__).resolve().parents[1]
_SPEC = importlib.util.spec_from_file_location(
    "reproducible_backend", _PACKAGE / "build_backend.py"
)
assert _SPEC and _SPEC.loader
backend = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(backend)
PROVENANCE = json.loads((_PACKAGE / "native/source.json").read_text())
SOURCE_ID = (
    f"urn:aphrody:rust-source:sha256:{PROVENANCE['archive_sha256']}#aphrody-rust@0.1.0"
)
SBOM = "aphrody-0.1.0.dist-info/sboms/aphrody-rust.cyclonedx.json"
RECORD = "aphrody-0.1.0.dist-info/RECORD"


def sbom(source):
    reference = f"path+file://{source}#aphrody-rust@0.1.0"
    target = reference + " bin-target-0"
    return {
        "bomFormat": "CycloneDX",
        "specVersion": "1.5",
        "version": 1,
        "metadata": {
            "component": {
                "name": "aphrody-rust",
                "version": "0.1.0",
                "bom-ref": reference,
                "components": [{"name": "aphrody_rust", "bom-ref": target}],
            }
        },
        "components": [
            {
                "name": "pyo3",
                "version": "0.29.0",
                "bom-ref": "pyo3",
                "licenses": [{"license": {"id": "MIT"}}],
                "hashes": [{"alg": "SHA-256", "content": "a" * 64}],
            }
        ],
        "dependencies": [
            {"ref": reference, "dependsOn": [target]},
            {"ref": target, "dependsOn": ["pyo3"]},
            {"ref": "pyo3", "dependsOn": []},
        ],
    }


def test_sbom_references_preserve_all_component_details_and_graph_edges():
    document = sbom("/tmp/direct/native")
    original = deepcopy(document)
    expected = deepcopy(document)
    expected["metadata"]["component"]["bom-ref"] = SOURCE_ID
    expected["metadata"]["component"]["components"][0]["bom-ref"] = (
        SOURCE_ID + " bin-target-0"
    )
    expected["dependencies"][0] = {
        "ref": SOURCE_ID,
        "dependsOn": [SOURCE_ID + " bin-target-0"],
    }
    expected["dependencies"][1]["ref"] = SOURCE_ID + " bin-target-0"
    assert backend._source_sbom(document, PROVENANCE) == expected
    assert document == original
    assert backend._source_sbom(sbom("/tmp/rebuilt/native"), PROVENANCE) == expected


def test_source_identity_changes_when_pinned_source_changes():
    changed = {**PROVENANCE, "archive_sha256": "b" * 64}
    assert backend._source_sbom(sbom("/tmp/native"), changed) != backend._source_sbom(
        sbom("/tmp/native"), PROVENANCE
    )


@pytest.mark.parametrize("identity", ["", "b" * 63, "g" * 64])
def test_invalid_source_hash_cannot_define_provenance(identity):
    with pytest.raises(ValueError, match="source archive identity"):
        backend._source_sbom(
            sbom("/tmp/native"), {**PROVENANCE, "archive_sha256": identity}
        )


def wheel(path, source, *, editable=False, corrupt=False):
    contents = {
        "aphrody/__init__.py": b'"""Python facade."""\n',
        SBOM: json.dumps(sbom(source)).encode(),
        RECORD: b"",
    }
    if not editable:
        contents["aphrody/native-source.json"] = json.dumps(PROVENANCE).encode()
    contents[RECORD] = backend._record(contents, RECORD)
    if corrupt:
        contents["aphrody/__init__.py"] += b"changed after RECORD\n"
    with zipfile.ZipFile(path, "w") as archive:
        for name, data in contents.items():
            info = zipfile.ZipInfo(name, date_time=(2024, 10, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)


def test_finalized_wheels_are_identical_and_record_covers_actual_members(
    tmp_path,
):
    first, second = tmp_path / "direct.whl", tmp_path / "rebuilt.whl"
    wheel(first, "/tmp/direct/native")
    wheel(second, "/tmp/rebuilt/native")
    original = json.loads(zipfile.ZipFile(first).read(SBOM))
    backend._finalize_wheel(first)
    backend._finalize_wheel(second)
    assert first.read_bytes() == second.read_bytes()
    with zipfile.ZipFile(first) as archive:
        contents = {name: archive.read(name) for name in archive.namelist()}
    assert json.loads(contents[SBOM]) == backend._source_sbom(original, PROVENANCE)
    assert contents[RECORD] == backend._record(contents, RECORD)
    assert {
        row[0] for row in csv.reader(io.StringIO(contents[RECORD].decode()))
    } == set(contents)
    assert (
        hashlib.sha256(contents["aphrody/__init__.py"]).hexdigest()
        == hashlib.sha256(b'"""Python facade."""\n').hexdigest()
    )


def test_finalizer_rejects_corrupt_maturin_output_without_rewriting_it(
    tmp_path,
):
    artifact = tmp_path / "corrupt.whl"
    wheel(artifact, "/tmp/native", corrupt=True)
    original = artifact.read_bytes()
    with pytest.raises(ValueError, match="RECORD integrity"):
        backend._finalize_wheel(artifact)
    assert artifact.read_bytes() == original


def test_editable_wheel_uses_verified_recipe_provenance(tmp_path):
    artifact = tmp_path / "editable.whl"
    wheel(artifact, "/tmp/native", editable=True)
    with pytest.raises(ValueError, match="missing verified native provenance"):
        backend._finalize_wheel(artifact)
    backend._finalize_wheel(artifact, editable=True)
    with zipfile.ZipFile(artifact) as archive:
        result = json.loads(archive.read(SBOM))
    assert result["metadata"]["component"]["bom-ref"] == SOURCE_ID
