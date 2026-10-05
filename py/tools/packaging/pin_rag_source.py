# SPDX-License-Identifier: Apache-2.0
"""Pin the canonical RAG math wrapper and core modules from committed Git bytes."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import subprocess
import tarfile
from pathlib import Path


def pin(repository: Path, revision: str, package: Path) -> dict:
    def git(*args: str) -> bytes:
        return subprocess.check_output(["git", "-C", str(repository), *args])

    revision = git("rev-parse", f"{revision}^{{commit}}").decode().strip()
    canonical = {
        "src/lib.rs": "crates/ai/rag-python/src/lib.rs",
        "src/fusion.rs": "crates/ai/rag-core/src/fusion.rs",
        "src/vectors_f64.rs": "crates/ai/rag-core/src/vectors_f64.rs",
        "src/vectors_f32.rs": "crates/ai/rag-core/src/vectors_f32.rs",
    }
    sources = {
        name: git("show", f"{revision}:{path}") for name, path in canonical.items()
    }
    sources["src/lib.rs"] = (
        b"extern crate self as aphrody_rag_core;\npub mod fusion;\npub mod vectors_f64;\npub mod vectors_f32;\n"
        + sources["src/lib.rs"]
    )
    tar_bytes = io.BytesIO()
    with tarfile.open(
        fileobj=tar_bytes, mode="w", format=tarfile.USTAR_FORMAT
    ) as archive:
        for name, content in sorted(sources.items()):
            member = tarfile.TarInfo(name)
            member.size, member.mode, member.mtime = len(content), 0o644, 0
            archive.addfile(member, io.BytesIO(content))
    artifact = gzip.compress(tar_bytes.getvalue(), mtime=0)
    provenance = {
        "schema_version": 1,
        "repository": "aphrody",
        "revision": revision,
        "canonical_path": canonical["src/lib.rs"],
        "canonical_core_path": canonical["src/fusion.rs"],
        "canonical_vector_path": canonical["src/vectors_f64.rs"],
        "canonical_float32_vector_path": canonical["src/vectors_f32.rs"],
        "projection": "wrapper bytes plus crate alias/module declarations; core module bytes unchanged",
        "license": "Apache-2.0",
        "archive_sha256": hashlib.sha256(artifact).hexdigest(),
        "files": {
            name: {"sha256": hashlib.sha256(content).hexdigest(), "size": len(content)}
            for name, content in sorted(sources.items())
        },
    }
    native = package / "native"
    native.mkdir(parents=True, exist_ok=True)
    (native / "source.tar.gz").write_bytes(artifact)
    (native / "source.json").write_text(json.dumps(provenance, indent=2) + "\n")
    return provenance


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--revision", default="HEAD")
    parser.add_argument(
        "--package",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "packages/aphrody",
    )
    options = parser.parse_args()
    print(
        json.dumps(pin(options.repository, options.revision, options.package), indent=2)
    )
