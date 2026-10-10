# SPDX-License-Identifier: Apache-2.0
"""Real installed C ABI lifecycle and pre-load verification regression gates."""

import ctypes
import hashlib
import json
import shutil
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from aphrody.yolo_runtime import (
    Buffer,
    CreateInfo,
    ProcessStatus,
    Runtime,
    RuntimeError,
    SpawnInfo,
    SpawnInfoV14,
    artifact_directory,
    host_target,
    verify_artifact,
)


@pytest.fixture
def native():
    directory = artifact_directory()
    if not (directory / "manifest.json").is_file():
        pytest.skip(
            "Installed Yolo runtime absent; execution qualification unavailable"
        )
    with Runtime(directory) as runtime:
        yield runtime


def until(predicate):
    deadline = time.monotonic() + 5
    while not predicate():
        assert time.monotonic() < deadline, "native completion deadline exceeded"
        time.sleep(0.005)


def test_c_layout():
    assert ctypes.sizeof(CreateInfo) == 16
    assert ctypes.sizeof(ProcessStatus) == 20
    assert SpawnInfo.program.offset == 8
    assert SpawnInfoV14.capture_limit.offset == ctypes.sizeof(SpawnInfo)
    assert ctypes.sizeof(Buffer) == 3 * ctypes.sizeof(ctypes.c_void_p)


def test_native_stats_bench_and_reserved_capabilities(native):
    assert native.abi[0] == 1 and native.abi[1] >= 4
    assert set(native.capabilities()) == {
        "system.stats",
        "bench.compute",
        "process.supervise",
        "http.probe",
    }
    assert isinstance(native.stats(), dict)
    assert native.build_info()["target"] == host_target()
    with native.bench(100) as operation:
        assert isinstance(operation.wait(5000), dict)
    with pytest.raises(RuntimeError, match="Unsupported"):
        native.require("desktop.window")


def test_native_binary_lossless_capture_env_cwd(native, tmp_path):
    script = "import os,sys;sys.stdout.buffer.write(b'\\x00\\xff'+os.environ['YOLO_TEST'].encode());sys.stderr.write(os.getcwd())"
    with native.spawn(
        sys.executable, ("-c", script), env={"YOLO_TEST": "portable"}, cwd=tmp_path
    ) as process:
        until(lambda: process.status()["state"] == 1 and process.output_complete())
        assert process.status()["exit_code"] == 0
        assert process.read(peek=True) == b"\x00\xffportable"
        assert process.read() == b"\x00\xffportable"
        assert process.read() == b""
        assert process.read(stderr=True).decode() == str(tmp_path)
    with pytest.raises(RuntimeError, match="closed"):
        process.status()


def test_native_stop_async_and_runtime_close(native):
    process = native.spawn(sys.executable, ("-c", "import time;time.sleep(60)"))
    with process.stop_async(20) as operation:
        assert isinstance(operation.wait(5000), dict)
    assert process.status()["state"] == 1
    process.close()
    native.close()
    native.close()
    with pytest.raises(RuntimeError, match="closed"):
        native.stats()


def test_native_cancel_timeout_retry_and_slot_budget():
    if not (artifact_directory() / "manifest.json").is_file():
        pytest.skip("Installed runtime absent")
    with Runtime(max_operations=1) as runtime:
        with runtime.bench(0xFFFFFFFF) as operation:
            with pytest.raises(RuntimeError) as timeout:
                operation.wait(0)
            assert timeout.value.status == 5
            with pytest.raises(RuntimeError) as busy:
                runtime.bench(1)
            assert busy.value.status == 6
            operation.cancel()
            with pytest.raises(RuntimeError) as cancelled:
                operation.wait(5000)
            assert cancelled.value.status == 4
        with runtime.bench(1) as operation:
            assert isinstance(operation.wait(5000), dict)


def test_native_capture_overflow_persistent(native):
    with native.spawn(
        sys.executable, ("-c", "print('x'*1000)"), capture_limit=10
    ) as process:
        until(lambda: process.status()["state"] == 1 and process.output_complete())
        for _ in range(2):
            with pytest.raises(RuntimeError) as overflow:
                process.read()
            assert overflow.value.status == 9


def test_native_http_probe(native):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(204)
            self.end_headers()

        def log_message(self, *_):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    try:
        with native.probe("127.0.0.1", server.server_port) as operation:
            assert operation.wait(5000)["status"] == 204
    finally:
        server.shutdown()
        thread.join()
        server.server_close()


def synthetic_artifact(tmp_path, header_name="yolo_runtime.h"):
    library = tmp_path / "libyolo_runtime.so"
    header = tmp_path / header_name
    library.write_bytes(b"synthetic library: must never load")
    header.write_bytes(b"synthetic header")
    manifest = {
        "schema": 1,
        "name": "yolo-runtime",
        "target": host_target(),
        "abi": "1.4",
        "compatibility": {"abiMajor": 1},
        "sources": {"yolo": {"rev": "a" * 40, "dirty": False}},
        "build": {"panicRecovery": True},
        "files": {},
    }
    for path in (library, header):
        manifest["files"][path.name] = {
            "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    return manifest


@pytest.mark.parametrize(
    "mutation",
    ["hash", "size", "target", "major", "minor", "dirty", "revision", "path", "panic"],
)
def test_refuse_invalid_artifact_before_cdll(tmp_path, monkeypatch, mutation):
    manifest = synthetic_artifact(tmp_path)
    if mutation == "hash":
        manifest["files"]["libyolo_runtime.so"]["sha256"] = "0" * 64
    elif mutation == "size":
        manifest["files"]["libyolo_runtime.so"]["bytes"] = 0
    elif mutation == "target":
        manifest["target"] = "foreign"
    elif mutation == "major":
        manifest["compatibility"]["abiMajor"] = 2
    elif mutation == "minor":
        manifest["abi"] = "1.3"
    elif mutation == "dirty":
        manifest["sources"]["yolo"]["dirty"] = True
    elif mutation == "revision":
        manifest["sources"]["yolo"]["rev"] = "unpinned"
    elif mutation == "panic":
        manifest["build"]["panicRecovery"] = False
    else:
        manifest["files"]["../outside.so"] = manifest["files"].pop("libyolo_runtime.so")
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    monkeypatch.setattr(
        ctypes, "CDLL", lambda *_: pytest.fail("invalid artifact executed native code")
    )
    with pytest.raises(RuntimeError, match="Invalid Yolo artifact"):
        Runtime(tmp_path)


def test_discovery_home_and_explicit_library(tmp_path, monkeypatch):
    monkeypatch.delenv("YOLO_RUNTIME_LIB", raising=False)
    monkeypatch.delenv("YOLO_RUNTIME_HOME", raising=False)
    monkeypatch.setenv("YOLO_HOME", str(tmp_path / "spaces home"))
    assert (
        artifact_directory()
        == tmp_path / "spaces home" / "runtime" / host_target() / "current"
    )
    monkeypatch.setenv("YOLO_RUNTIME_HOME", str(tmp_path / "override"))
    assert artifact_directory() == tmp_path / "override" / host_target() / "current"
    monkeypatch.setenv("YOLO_RUNTIME_LIB", str(tmp_path / "explicit" / "library.so"))
    assert artifact_directory() == tmp_path / "explicit"


@pytest.mark.parametrize("header_name", ["aphrody.h", "yolo_runtime.h"])
def test_accept_either_header_name(tmp_path, header_name):
    synthetic_artifact(tmp_path, header_name)
    library, _ = verify_artifact(tmp_path)
    assert library == (tmp_path / "libyolo_runtime.so").resolve()


def test_refuse_artifact_without_header(tmp_path):
    synthetic_artifact(tmp_path, "notes.txt")
    with pytest.raises(RuntimeError, match="versioned header required"):
        verify_artifact(tmp_path)


def test_reject_payload_symlink(tmp_path):
    synthetic_artifact(tmp_path)
    library = tmp_path / "libyolo_runtime.so"
    other = tmp_path / "other"
    shutil.move(library, other)
    try:
        library.symlink_to(other)
    except OSError:
        pytest.skip("Host does not allow symlink creation")
    with pytest.raises(RuntimeError):
        verify_artifact(tmp_path)


def test_invalid_inputs_do_not_spawn(native):
    for args in [("bad\0program", ()), (sys.executable, ("bad\0arg",))]:
        with pytest.raises(ValueError):
            native.spawn(*args)
    with pytest.raises(ValueError):
        native.spawn(sys.executable, env={"bad=key": "x"})
    with pytest.raises(ValueError):
        native.probe("localhost", 65536)
    with pytest.raises(ValueError):
        native.bench(-1)


def test_native_runtime_destroy_stops_owned_child(native):
    process = native.spawn(sys.executable, ("-c", "import time;time.sleep(60)"))
    pid = process.status()["pid"]
    assert pid > 0
    native.close()
    with pytest.raises(RuntimeError, match="closed"):
        process.status()
    process.close()
    if sys.platform != "win32":
        import os

        with pytest.raises(ProcessLookupError):
            os.kill(pid, 0)


def test_native_thread_safe_handle_lifetime(native):
    results = []
    errors = []

    def worker():
        try:
            results.append(native.stats())
        except Exception as exc:
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=5)
        assert not thread.is_alive()
    assert len(results) == 8
    assert not errors


def test_manifest_provenance_mismatch_refused_after_load(tmp_path, monkeypatch):
    source = artifact_directory()
    if not (source / "manifest.json").is_file():
        pytest.skip("Installed runtime absent")
    monkeypatch.delenv("YOLO_RUNTIME_LIB", raising=False)
    shutil.copytree(source, tmp_path / "artifact")
    directory = tmp_path / "artifact"
    manifest = json.loads((directory / "manifest.json").read_text())
    manifest["sources"]["yolo"]["rev"] = "b" * 40
    (directory / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(RuntimeError, match="Embedded producer revision"):
        Runtime(directory)
