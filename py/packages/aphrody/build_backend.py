# SPDX-License-Identifier: Apache-2.0
"""Verify pinned native source and delegate PEP 517 builds to maturin.

Only packaging lives here; the compressed Rust source comes from the canonical
Aphrody Rust repository. Building a wheel or sdist needs no adjacent checkout.
"""

from __future__ import annotations

import base64
import csv
import hashlib
import importlib
import io
import json
import os
import tarfile
import tempfile
import zipfile
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parent
_SOURCE_FILES = frozenset(
    {"src/lib.rs", "src/fusion.rs", "src/vectors_f64.rs", "src/vectors_f32.rs"}
)
_MAX_ARCHIVE_BYTES = 1024 * 1024
_MAX_SOURCE_BYTES = 1024 * 1024


def _prepare_native(root: Path | None = None) -> None:
    """Validate the entire artifact before writing any generated source."""
    root = root or _ROOT
    native = root / "native"
    provenance_bytes = (native / "source.json").read_bytes()
    provenance = json.loads(provenance_bytes)
    if provenance.get("schema_version") != 1:
        raise ValueError("Unsupported native source provenance schema")
    files = provenance.get("files")
    if not isinstance(files, dict) or set(files) != _SOURCE_FILES:
        raise ValueError("Native source file allowlist does not match provenance")
    artifact_path = native / "source.tar.gz"
    if artifact_path.stat().st_size > _MAX_ARCHIVE_BYTES:
        raise ValueError("Native source archive exceeds size limit")
    artifact = artifact_path.read_bytes()
    if hashlib.sha256(artifact).hexdigest() != provenance.get("archive_sha256"):
        raise ValueError("Native source archive SHA-256 mismatch")
    verified: dict[str, bytes] = {}
    with tarfile.open(fileobj=io.BytesIO(artifact), mode="r:gz") as archive:
        for member in archive:
            if (
                member.name not in _SOURCE_FILES
                or member.name in verified
                or not member.isfile()
                or member.size > _MAX_SOURCE_BYTES
            ):
                raise ValueError("Unsafe or unexpected native source archive member")
            expected = files[member.name]
            source_file = archive.extractfile(member)
            if source_file is None:
                raise ValueError("Native source archive member cannot be read")
            with source_file:
                content = source_file.read(_MAX_SOURCE_BYTES + 1)
            if len(content) != expected.get("size") or hashlib.sha256(
                content
            ).hexdigest() != expected.get("sha256"):
                raise ValueError("Native source file SHA-256 or size mismatch")
            verified[member.name] = content
    if set(verified) != _SOURCE_FILES:
        raise ValueError("Native source archive is incomplete")
    for name, content in verified.items():
        _write_generated(native / name, content)
    # Carry the verified recipe provenance into the installed release artifact.
    _write_generated(root / "src/aphrody/native-source.json", provenance_bytes)


def _write_generated(destination: Path, content: bytes) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Never follow a pre-existing symlink outside the package during a build.
    if destination.parent.is_symlink() or destination.is_symlink():
        raise ValueError("Generated native source path cannot be a symlink")
    if destination.exists() and destination.read_bytes() == content:
        return
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as file:
            temporary = Path(file.name)
            file.write(content)
        temporary.chmod(0o644)
        os.replace(temporary, destination)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _delegate(hook: str, *args: Any, **kwargs: Any) -> Any:
    _prepare_native()
    return getattr(importlib.import_module("maturin"), hook)(*args, **kwargs)


def _source_sbom(sbom: dict, provenance: dict) -> dict:
    """Give the local source a stable identity without changing its graph.

    CycloneDX bom-ref values are logical identifiers, not source locations.
    Maturin 1.14.1 derives them from Cargo's temporary source directory.
    """
    component = sbom["metadata"]["component"]
    reference = component["bom-ref"]
    if (
        component.get("name") != "aphrody-rust"
        or component.get("version") != "0.1.0"
        or not reference.startswith("path+file://")
        or not reference.endswith("#aphrody-rust@0.1.0")
    ):
        raise ValueError("Unexpected local Rust component identity in SBOM")
    source_hash = provenance["archive_sha256"]
    if len(source_hash) != 64 or any(
        char not in "0123456789abcdef" for char in source_hash
    ):
        raise ValueError("Invalid pinned source archive identity")
    stable = f"urn:aphrody:rust-source:sha256:{source_hash}#aphrody-rust@0.1.0"

    def replace(item):
        if isinstance(item, dict):
            result = {}
            for key, original in item.items():
                value = original
                if key in {"bom-ref", "ref"}:
                    value = replace_reference(value)
                elif key == "dependsOn":
                    value = [replace_reference(ref) for ref in value]
                result[key] = replace(value)
            return result
        if isinstance(item, list):
            return [replace(value) for value in item]
        return item

    def replace_reference(value):
        if isinstance(value, str) and (
            value == reference or value.startswith(reference + " ")
        ):
            return stable + value[len(reference) :]
        return value

    return replace(sbom)


def _record(contents: dict[str, bytes], record: str) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    for name in sorted(contents):
        if name == record:
            writer.writerow([name, "", ""])
        else:
            content = contents[name]
            digest = (
                base64.urlsafe_b64encode(hashlib.sha256(content).digest())
                .decode()
                .rstrip("=")
            )
            writer.writerow([name, f"sha256={digest}", str(len(content))])
    return output.getvalue().encode()


def _finalize_wheel(wheel: Path, *, editable: bool = False) -> None:
    """Retain the complete SBOM with pinned root IDs and an exact RECORD."""
    with zipfile.ZipFile(wheel) as archive:
        infos = archive.infolist()
        contents = {info.filename: archive.read(info) for info in infos}
        comment = archive.comment
    if len(contents) != len(infos):
        raise ValueError("Wheel contains duplicate members")
    record = next(name for name in contents if name.endswith(".dist-info/RECORD"))
    if any(
        name.endswith((".dist-info/RECORD.jws", ".dist-info/RECORD.p7s"))
        for name in contents
    ):
        raise ValueError("Cannot finalize an already signed wheel")
    rows = list(csv.reader(io.StringIO(contents[record].decode())))
    if {row[0] for row in rows} != set(contents):
        raise ValueError("Maturin wheel RECORD does not enumerate its members")
    for name, digest, size in rows:
        if name == record and digest == size == "":
            continue
        content = contents[name]
        actual = (
            base64.urlsafe_b64encode(hashlib.sha256(content).digest())
            .decode()
            .rstrip("=")
        )
        if digest != f"sha256={actual}" or size != str(len(content)):
            raise ValueError(f"Maturin wheel RECORD integrity failed: {name}")
    provenance_bytes = contents.get("aphrody/native-source.json")
    if provenance_bytes is None and editable:
        # Editable wheels point to the verified package rather than embedding it.
        provenance_bytes = (_ROOT / "native/source.json").read_bytes()
    if provenance_bytes is None:
        raise ValueError("Release wheel is missing verified native provenance")
    provenance = json.loads(provenance_bytes)
    sbom = next(
        name
        for name in contents
        if name.endswith(".dist-info/sboms/aphrody-rust.cyclonedx.json")
    )
    document = _source_sbom(json.loads(contents[sbom]), provenance)
    contents[sbom] = (
        json.dumps(document, sort_keys=True, separators=(",", ":")) + "\n"
    ).encode()
    contents[record] = _record(contents, record)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=wheel.parent, delete=False) as file:
            temporary = Path(file.name)
        with zipfile.ZipFile(temporary, "w") as archive:
            archive.comment = comment
            for info in sorted(
                infos,
                key=lambda info: (
                    ".dist-info/" in info.filename,
                    info.filename,
                ),
            ):
                archive.writestr(info, contents[info.filename])
        temporary.chmod(wheel.stat().st_mode & 0o777)
        os.replace(temporary, wheel)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def get_requires_for_build_wheel(config_settings=None):
    """Return maturin wheel build requirements after verifying native source."""
    return _delegate("get_requires_for_build_wheel", config_settings)


def get_requires_for_build_sdist(config_settings=None):
    """Return maturin sdist build requirements after verifying native source."""
    return _delegate("get_requires_for_build_sdist", config_settings)


def get_requires_for_build_editable(config_settings=None):
    """Return maturin editable requirements after verifying native source."""
    return _delegate("get_requires_for_build_editable", config_settings)


def prepare_metadata_for_build_wheel(metadata_directory, config_settings=None):
    """Prepare wheel metadata with the pinned native recipe."""
    return _delegate(
        "prepare_metadata_for_build_wheel", metadata_directory, config_settings
    )


def prepare_metadata_for_build_editable(metadata_directory, config_settings=None):
    """Prepare editable metadata with the pinned native recipe."""
    return _delegate(
        "prepare_metadata_for_build_editable",
        metadata_directory,
        config_settings,
    )


def build_wheel(wheel_directory, config_settings=None, metadata_directory=None):
    """Build a wheel containing the verified native extension."""
    wheel_name = _delegate(
        "build_wheel", wheel_directory, config_settings, metadata_directory
    )
    _finalize_wheel(Path(wheel_directory) / wheel_name)
    return wheel_name


def build_sdist(sdist_directory, config_settings=None):
    """Build a self-contained source distribution."""
    return _delegate("build_sdist", sdist_directory, config_settings)


def build_editable(wheel_directory, config_settings=None, metadata_directory=None):
    """Build an editable wheel containing the verified native extension."""
    wheel_name = _delegate(
        "build_editable", wheel_directory, config_settings, metadata_directory
    )
    _finalize_wheel(Path(wheel_directory) / wheel_name, editable=True)
    return wheel_name
