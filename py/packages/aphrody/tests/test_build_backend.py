# SPDX-License-Identifier: Apache-2.0
"""Source-artifact integrity and PEP 517 delegation checks."""

import gzip
import hashlib
import importlib.util
import io
import json
import shutil
import tarfile
from pathlib import Path
from types import SimpleNamespace

import pytest

_PACKAGE = Path(__file__).resolve().parents[1]
_SPEC = importlib.util.spec_from_file_location(
    "aphrody_build_backend", _PACKAGE / "build_backend.py"
)
assert _SPEC and _SPEC.loader
backend = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(backend)


@pytest.fixture
def package(tmp_path):
    native = tmp_path / "native"
    native.mkdir()
    for name in ("source.json", "source.tar.gz"):
        shutil.copyfile(_PACKAGE / "native" / name, native / name)
    return tmp_path


def _replace_archive(package, members):
    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode="w") as archive:
        for name, content, kind in members:
            member = tarfile.TarInfo(name)
            member.type = kind
            member.size = len(content)
            archive.addfile(member, io.BytesIO(content))
    artifact = gzip.compress(data.getvalue(), mtime=0)
    (package / "native/source.tar.gz").write_bytes(artifact)
    provenance_path = package / "native/source.json"
    provenance = json.loads(provenance_path.read_text())
    provenance["archive_sha256"] = hashlib.sha256(artifact).hexdigest()
    provenance_path.write_text(json.dumps(provenance))


def test_materializes_canonical_source_and_replaces_modified_output(package):
    backend._prepare_native(package)
    destination = package / "native/src/lib.rs"
    assert (package / "src/aphrody/native-source.json").read_bytes() == (
        package / "native/source.json"
    ).read_bytes()
    provenance = json.loads((package / "native/source.json").read_text())
    for name, expected in provenance["files"].items():
        source = (package / "native" / name).read_bytes()
        assert len(source) == expected["size"]
        assert hashlib.sha256(source).hexdigest() == expected["sha256"]
    assert (
        hashlib.sha256(destination.read_bytes()).hexdigest()
        == provenance["files"]["src/lib.rs"]["sha256"]
    )
    destination.write_text("modified generated file")
    backend._prepare_native(package)
    assert (
        hashlib.sha256(destination.read_bytes()).hexdigest()
        == provenance["files"]["src/lib.rs"]["sha256"]
    )


def test_rejects_modified_archive_without_writing_source(package):
    artifact = package / "native/source.tar.gz"
    artifact.write_bytes(artifact.read_bytes() + b"changed")
    with pytest.raises(ValueError, match="archive SHA-256"):
        backend._prepare_native(package)
    assert not (package / "native/src").exists()


@pytest.mark.parametrize(
    "members, message",
    [
        ([("../outside.rs", b"bad", tarfile.REGTYPE)], "unexpected"),
        ([("src/lib.rs", b"bad", tarfile.SYMTYPE)], "unexpected"),
        ([("src/lib.rs", b"bad", tarfile.REGTYPE)], "file SHA-256"),
        ([], "incomplete"),
    ],
)
def test_rejects_untrusted_archive_members(package, members, message):
    _replace_archive(package, members)
    with pytest.raises(ValueError, match=message):
        backend._prepare_native(package)
    assert not (package / "native/src").exists()


def test_rejects_symlink_output_directory(package, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    try:
        (package / "native/src").symlink_to(outside, target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("Host does not permit creating directory symlinks")
    with pytest.raises(ValueError, match="symlink"):
        backend._prepare_native(package)
    assert not (outside / "lib.rs").exists()


@pytest.mark.parametrize(
    "hook, args",
    [
        ("get_requires_for_build_wheel", ({},)),
        ("get_requires_for_build_sdist", ({},)),
        ("get_requires_for_build_editable", ({},)),
        ("prepare_metadata_for_build_wheel", ("metadata", {})),
        ("prepare_metadata_for_build_editable", ("metadata", {})),
        ("build_wheel", ("wheel", {}, "metadata")),
        ("build_sdist", ("sdist", {})),
        ("build_editable", ("wheel", {}, "metadata")),
    ],
)
def test_pep517_hooks_verify_before_delegating(package, monkeypatch, hook, args):
    calls = []
    finalized = []

    def delegate(*received):
        assert (package / "native/src/lib.rs").is_file()
        calls.append(received)
        return "delegated"

    monkeypatch.setattr(backend, "_ROOT", package)
    monkeypatch.setattr(
        backend,
        "_finalize_wheel",
        lambda path, **kwargs: finalized.append((path, kwargs)),
    )
    monkeypatch.setattr(
        backend.importlib,
        "import_module",
        lambda name: SimpleNamespace(**{hook: delegate}),
    )
    assert getattr(backend, hook)(*args) == "delegated"
    assert calls == [args]
    expected = []
    if hook in {"build_wheel", "build_editable"}:
        expected = [
            (
                Path(args[0]) / "delegated",
                {"editable": True} if hook == "build_editable" else {},
            )
        ]
    assert finalized == expected
