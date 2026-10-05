# SPDX-License-Identifier: Apache-2.0
"""Pinned distributions retain every core module used by the native wrapper."""

import hashlib
import importlib.util
import subprocess
import tarfile
from pathlib import Path


def test_pin_keeps_float32_module_and_committed_bytes(tmp_path):
    tool = Path(__file__).resolve().parents[3] / "tools/packaging/pin_rag_source.py"
    spec = importlib.util.spec_from_file_location("pin_rag_source", tool)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    repository, package = tmp_path / "repository", tmp_path / "package"
    repository.mkdir()
    sources = {
        "src/lib.rs": "crates/ai/rag-python/src/lib.rs",
        "src/fusion.rs": "crates/ai/rag-core/src/fusion.rs",
        "src/vectors_f64.rs": "crates/ai/rag-core/src/vectors_f64.rs",
        "src/vectors_f32.rs": "crates/ai/rag-core/src/vectors_f32.rs",
    }
    expected = {}
    for name, source in sources.items():
        path = repository / source
        path.parent.mkdir(parents=True, exist_ok=True)
        expected[name] = f"// canonical {name}\n".encode()
        path.write_bytes(expected[name])
    subprocess.run(["git", "init", "--quiet", str(repository)], check=True)
    subprocess.run(["git", "-C", str(repository), "add", "."], check=True)
    subprocess.run(
        [
            "git",
            "-C",
            str(repository),
            "-c",
            "user.name=fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "sources",
        ],
        check=True,
    )
    provenance = module.pin(repository, "HEAD", package)
    artifact = package / "native/source.tar.gz"
    original = artifact.read_bytes()
    assert provenance["canonical_float32_vector_path"] == sources["src/vectors_f32.rs"]
    assert provenance["archive_sha256"] == hashlib.sha256(original).hexdigest()
    with tarfile.open(artifact) as archive:
        assert set(archive.getnames()) == set(sources)
        for name in sources:
            member = archive.extractfile(name)
            assert member is not None
            content = member.read()
            if name == "src/lib.rs":
                assert b"pub mod vectors_f32;\n" in content
                assert content.endswith(expected[name])
            else:
                assert content == expected[name]
            assert (
                provenance["files"][name]["sha256"]
                == hashlib.sha256(content).hexdigest()
            )
    (repository / sources["src/vectors_f32.rs"]).write_text("// uncommitted change\n")
    assert module.pin(repository, "HEAD", package) == provenance
    assert artifact.read_bytes() == original
