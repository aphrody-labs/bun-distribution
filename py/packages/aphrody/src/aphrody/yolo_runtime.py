# SPDX-License-Identifier: Apache-2.0
"""Thin, verified ctypes consumer of Yolo's additive C ABI 1.4.

Native Yolo owns workers, processes and buffers. This module never builds or
installs a runtime. Use context managers to release every owned handle.
"""

from __future__ import annotations

import ctypes as c
import hashlib
import json
import os
import platform
import re
import threading
from pathlib import Path
from typing import Any

ABI_MAJOR, ABI_MINOR = 1, 4
MAX_CAPTURE = 67_108_864


class RuntimeError(Exception):
    """Native status or artifact verification failure."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class Buffer(c.Structure):
    _fields_ = [
        ("data", c.POINTER(c.c_uint8)),
        ("len", c.c_size_t),
        ("cap", c.c_size_t),
    ]


class CreateInfo(c.Structure):
    _fields_ = [
        (name, c.c_uint32)
        for name in ("struct_size", "abi_major", "abi_minor", "max_operations")
    ]


class SpawnInfo(c.Structure):
    _fields_ = [
        ("struct_size", c.c_uint32),
        ("flags", c.c_uint32),
        ("program", c.c_char_p),
        ("args", c.POINTER(c.c_char_p)),
        ("env", c.POINTER(c.c_char_p)),
        ("cwd", c.c_char_p),
    ]


class SpawnInfoV14(c.Structure):
    _fields_ = [("base", SpawnInfo), ("capture_limit", c.c_uint64)]


class ProcessStatus(c.Structure):
    _fields_ = [
        ("struct_size", c.c_uint32),
        ("state", c.c_uint32),
        ("exit_code", c.c_int32),
        ("signal", c.c_int32),
        ("pid", c.c_uint32),
    ]


def host_target() -> str:
    machine = platform.machine().lower()
    arch = {
        "amd64": "x86_64",
        "x86_64": "x86_64",
        "arm64": "aarch64",
        "aarch64": "aarch64",
    }.get(machine)
    targets = {
        ("Linux", "x86_64"): "x86_64-unknown-linux-gnu",
        ("Linux", "aarch64"): "aarch64-unknown-linux-gnu",
        ("Darwin", "x86_64"): "x86_64-apple-darwin",
        ("Darwin", "aarch64"): "aarch64-apple-darwin",
        ("Windows", "x86_64"): "x86_64-pc-windows-msvc",
    }
    try:
        return targets[(platform.system(), arch)]  # type: ignore[index]
    except KeyError as exc:
        raise RuntimeError("Unsupported Yolo platform") from exc


def artifact_directory() -> Path:
    """Resolve existing installation; no implicit checkout fallback."""
    explicit = os.environ.get("YOLO_RUNTIME_LIB")
    if explicit:
        return Path(explicit).expanduser().resolve().parent
    home = os.environ.get("YOLO_RUNTIME_HOME")
    base = (
        Path(home).expanduser()
        if home
        else Path(os.environ.get("YOLO_HOME", str(Path.home() / ".yolo"))).expanduser()
        / "runtime"
    )
    return (base / host_target() / "current").resolve()


def verify_artifact(directory: Path) -> tuple[Path, dict[str, Any]]:
    """Validate producer provenance and every payload before executing native code.

    Hashes establish consistency with the locally trusted manifest, not publisher
    authenticity. Provision this manifest through the existing release owner.
    """
    directory = directory.expanduser().resolve()
    try:
        manifest = json.loads((directory / "manifest.json").read_text())
        if manifest["schema"] != 1 or manifest["name"] != "yolo-runtime":
            raise ValueError("unsupported artifact schema/name")
        if (
            manifest["target"] != host_target()
            or manifest["compatibility"]["abiMajor"] != ABI_MAJOR
        ):
            raise ValueError("artifact target/ABI mismatch")
        major, minor = map(int, manifest["abi"].split("."))
        if major != ABI_MAJOR or minor < ABI_MINOR:
            raise ValueError("ABI 1.4 or newer required")
        source = manifest["sources"]["yolo"]
        if (
            not re.fullmatch(r"[0-9a-f]{40}", source["rev"])
            or source["dirty"] is not False
        ):
            raise ValueError("clean pinned producer revision required")
        if manifest["build"]["panicRecovery"] is not True:
            raise ValueError("panic recovery required")
        files = manifest["files"]
        if not isinstance(files, dict) or not files:
            raise ValueError("empty file manifest")
        libraries = []
        for name, expected in files.items():
            if Path(name).name != name or name in {".", ".."} or "\\" in name:
                raise ValueError("non-local artifact path")
            path = directory / name
            if path.is_symlink() or not path.is_file():
                raise ValueError("artifact payload must be a regular local file")
            with path.open("rb") as stream:
                digest = hashlib.file_digest(stream, "sha256").hexdigest()
            if path.stat().st_size != expected["bytes"] or digest != expected["sha256"]:
                raise ValueError("artifact hash/size mismatch")
            if path.suffix in {".so", ".dll", ".dylib"}:
                libraries.append(path)
        # aphrody.h is the single header of the library; older artifacts carry yolo_runtime.h only.
        if len(libraries) != 1 or not ({"aphrody.h", "yolo_runtime.h"} & set(files)):
            raise ValueError("one library and versioned header required")
        explicit = os.environ.get("YOLO_RUNTIME_LIB")
        if explicit and Path(explicit).expanduser().resolve() != libraries[0]:
            raise ValueError("explicit library differs from verified manifest")
        return libraries[0], manifest
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
        raise RuntimeError(f"Invalid Yolo artifact: {exc}") from exc


def _utf8(value: str) -> bytes:
    if "\0" in value:
        raise ValueError("NUL is forbidden in native strings")
    return value.encode("utf-8")


def _u32(value: int, name: str) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not 0 <= value <= 0xFFFFFFFF
    ):
        raise ValueError(f"{name} must be an unsigned 32-bit integer")
    return value


class Runtime:
    """Shared native owner. Calls are serialized against close with a reentrant lock."""

    def __init__(self, directory: Path | None = None, *, max_operations: int = 4):
        if not 1 <= max_operations <= 64:
            raise ValueError("max_operations must be 1..64")
        library, self.manifest = verify_artifact(directory or artifact_directory())
        self._lock = threading.RLock()
        self._handle = 0
        self._lib = c.CDLL(str(library))
        abi = self._lib.yolo_abi_version
        abi.argtypes, abi.restype = [], c.c_uint32
        version = abi()
        if version >> 16 != ABI_MAJOR or version & 0xFFFF < ABI_MINOR:
            raise RuntimeError("Loaded library ABI mismatch")
        self.abi = (version >> 16, version & 0xFFFF)
        if f"{self.abi[0]}.{self.abi[1]}" != self.manifest["abi"]:
            raise RuntimeError("Loaded library ABI differs from manifest")
        h, u, b = c.c_uint64, c.c_uint32, c.POINTER(Buffer)
        signatures = {
            "runtime_create": ([c.POINTER(CreateInfo), c.POINTER(h)], c.c_int32),
            "runtime_destroy": ([h], c.c_int32),
            "runtime_build_info": ([b], c.c_int32),
            "runtime_capabilities": ([h, b], c.c_int32),
            "system_stats": ([h, b], c.c_int32),
            "bench_start": ([h, u, c.POINTER(h)], c.c_int32),
            "operation_wait": ([h, u, b], c.c_int32),
            "operation_cancel": ([h], c.c_int32),
            "operation_release": ([h], c.c_int32),
            "http_probe_start": (
                [h, c.c_char_p, c.c_uint16, c.c_char_p, u, c.POINTER(h)],
                c.c_int32,
            ),
            "process_spawn": ([h, c.POINTER(SpawnInfo), c.POINTER(h)], c.c_int32),
            "process_status": ([h, c.POINTER(ProcessStatus)], c.c_int32),
            "process_read": ([h, u, u, b], c.c_int32),
            "process_output_complete": ([h, c.POINTER(u)], c.c_int32),
            "process_stop": ([h, u], c.c_int32),
            "process_stop_start": ([h, u, c.POINTER(h)], c.c_int32),
            "process_release": ([h], c.c_int32),
            "last_error": ([b], c.c_int32),
            "buffer_free": ([b], None),
        }
        for name, (args, result) in signatures.items():
            function = getattr(self._lib, "yolo_" + name)
            function.argtypes, function.restype = args, result
        info = CreateInfo(c.sizeof(CreateInfo), ABI_MAJOR, ABI_MINOR, max_operations)
        out = h()
        self._check(self._lib.yolo_runtime_create(c.byref(info), c.byref(out)))
        self._handle = out.value
        try:
            build = self.build_info()
            embedded = build.get("git_rev", "")
            if (
                not isinstance(embedded, str)
                or not re.fullmatch(r"[0-9a-f]{12,40}", embedded)
                or not self.manifest["sources"]["yolo"]["rev"].startswith(embedded)
                or build.get("target") != self.manifest["target"]
                or build.get("abi") != self.manifest["abi"]
                or build.get("panic_recovery") is not True
            ):
                raise RuntimeError("Embedded producer revision differs from manifest")
        except BaseException:
            self.close()
            raise

    def _check(self, status: int) -> None:
        if status:
            error = Buffer()
            try:
                result = self._lib.yolo_last_error(c.byref(error))
                message = (
                    c.string_at(error.data, error.len).decode()
                    if result == 0
                    else "Native failure"
                )
            finally:
                self._lib.yolo_buffer_free(c.byref(error))
            raise RuntimeError(message, status)

    def _alive(self) -> int:
        if not self._handle:
            raise RuntimeError("Runtime closed")
        return self._handle

    def _buffer(self, name: str, *args: Any, decode: bool = True) -> Any:
        out = Buffer()
        try:
            self._check(getattr(self._lib, "yolo_" + name)(*args, c.byref(out)))
            data = c.string_at(out.data, out.len) if out.len else b""
            return json.loads(data) if decode else data
        finally:
            self._lib.yolo_buffer_free(c.byref(out))

    def build_info(self) -> dict[str, Any]:
        with self._lock:
            self._alive()
            return self._buffer("runtime_build_info")  # type: ignore[no-any-return]

    def capabilities(self) -> list[str]:
        with self._lock:
            return self._buffer("runtime_capabilities", self._alive())  # type: ignore[no-any-return]

    def require(self, capability: str) -> None:
        if capability not in self.capabilities():
            raise RuntimeError(f"Unsupported native capability: {capability}")

    def stats(self) -> dict[str, Any]:
        with self._lock:
            self.require("system.stats")
            return self._buffer("system_stats", self._alive())  # type: ignore[no-any-return]

    def _operation(self, name: str, *args: Any) -> Operation:
        with self._lock:
            out = c.c_uint64()
            self._check(
                getattr(self._lib, "yolo_" + name)(self._alive(), *args, c.byref(out))
            )
            return Operation(self, out.value)

    def bench(self, iterations: int) -> Operation:
        self.require("bench.compute")
        return self._operation("bench_start", _u32(iterations, "iterations"))

    def probe(
        self, host: str, port: int, path: str = "/", *, timeout_ms: int = 1000
    ) -> Operation:
        self.require("http.probe")
        if not 1 <= port <= 65535:
            raise ValueError("port must be 1..65535")
        return self._operation(
            "http_probe_start",
            _utf8(host),
            port,
            _utf8(path),
            _u32(timeout_ms, "timeout_ms"),
        )

    def spawn(
        self,
        program: str,
        args: tuple[str, ...] = (),
        *,
        env: dict[str, str] | None = None,
        cwd: Path | None = None,
        capture_limit: int = MAX_CAPTURE,
    ) -> Process:
        if not 1 <= capture_limit <= MAX_CAPTURE:
            raise ValueError("capture_limit must be 1..67108864")
        self.require("process.supervise")
        argv = (c.c_char_p * (len(args) + 1))(*map(_utf8, args), None)
        entries = []
        for key, value in (env or {}).items():
            if not key or "=" in key:
                raise ValueError("invalid environment key")
            entries.append(_utf8(key + "=" + value))
        environ = (c.c_char_p * (len(entries) + 1))(*entries, None)
        info = SpawnInfoV14(
            SpawnInfo(
                c.sizeof(SpawnInfoV14),
                4,
                _utf8(program),
                argv,
                environ,
                _utf8(str(cwd)) if cwd is not None else None,
            ),
            capture_limit,
        )
        with self._lock:
            out = c.c_uint64()
            self._check(
                self._lib.yolo_process_spawn(
                    self._alive(), c.byref(info.base), c.byref(out)
                )
            )
            return Process(self, out.value)

    def close(self) -> None:
        with self._lock:
            if self._handle:
                self._check(self._lib.yolo_runtime_destroy(self._handle))
                self._handle = 0

    def __enter__(self) -> Runtime:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()


class Operation:
    def __init__(self, runtime: Runtime, handle: int):
        self.runtime, self._handle = runtime, handle

    def _alive(self) -> int:
        self.runtime._alive()
        if not self._handle:
            raise RuntimeError("Handle closed")
        return self._handle

    def wait(self, timeout_ms: int = 1000) -> Any:
        """Native TIMEOUT raises status 5; operation remains valid for retry."""
        with self.runtime._lock:
            return self.runtime._buffer(
                "operation_wait", self._alive(), _u32(timeout_ms, "timeout_ms")
            )

    def cancel(self) -> None:
        with self.runtime._lock:
            self.runtime._check(self.runtime._lib.yolo_operation_cancel(self._alive()))

    def close(self) -> None:
        with self.runtime._lock:
            if self._handle and self.runtime._handle:
                self.runtime._check(
                    self.runtime._lib.yolo_operation_release(self._handle)
                )
            self._handle = 0

    def __enter__(self) -> Operation:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()


class Process:
    def __init__(self, runtime: Runtime, handle: int):
        self.runtime, self._handle = runtime, handle

    def _alive(self) -> int:
        self.runtime._alive()
        if not self._handle:
            raise RuntimeError("Handle closed")
        return self._handle

    def __enter__(self) -> Process:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()

    def status(self) -> dict[str, int]:
        with self.runtime._lock:
            out = ProcessStatus(c.sizeof(ProcessStatus), 0, 0, 0, 0)
            self.runtime._check(
                self.runtime._lib.yolo_process_status(self._alive(), c.byref(out))
            )
            return {
                name: int(getattr(out, name))
                for name in ("state", "exit_code", "signal", "pid")
            }

    def read(self, *, stderr: bool = False, peek: bool = False) -> bytes:
        with self.runtime._lock:
            return self.runtime._buffer(
                "process_read",
                self._alive(),
                2 if stderr else 1,
                int(peek),
                decode=False,
            )  # type: ignore[no-any-return]

    def output_complete(self) -> bool:
        with self.runtime._lock:
            out = c.c_uint32()
            self.runtime._check(
                self.runtime._lib.yolo_process_output_complete(
                    self._alive(), c.byref(out)
                )
            )
            return bool(out.value)

    def stop(self, grace_ms: int = 500) -> None:
        with self.runtime._lock:
            self.runtime._check(
                self.runtime._lib.yolo_process_stop(
                    self._alive(), _u32(grace_ms, "grace_ms")
                )
            )

    def stop_async(self, grace_ms: int = 500) -> Operation:
        with self.runtime._lock:
            out = c.c_uint64()
            self.runtime._check(
                self.runtime._lib.yolo_process_stop_start(
                    self._alive(), _u32(grace_ms, "grace_ms"), c.byref(out)
                )
            )
            return Operation(self.runtime, out.value)

    def close(self) -> None:
        with self.runtime._lock:
            if self._handle and self.runtime._handle:
                self.runtime._check(
                    self.runtime._lib.yolo_process_release(self._handle)
                )
            self._handle = 0
