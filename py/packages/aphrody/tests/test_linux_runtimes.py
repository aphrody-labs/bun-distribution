# SPDX-License-Identifier: Apache-2.0
"""Linux discovery must honor configured executables and avoid .exe defaults."""

import pytest

from aphrody import _paths
from aphrody.inference.harmony_reasoning import HarmonyRunner


def executable(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("#!/bin/sh\nexit 0\n")
    path.chmod(0o755)
    return path


def test_path_runtime_replaces_old_windows_default(monkeypatch, tmp_path):
    binary = executable(tmp_path / "llama-cli")
    monkeypatch.delenv("APHRODY_LLAMA_CLI_BIN", raising=False)
    monkeypatch.setenv("PATH", str(tmp_path))
    assert HarmonyRunner().cli_binary == binary


def test_override_takes_precedence_over_path(monkeypatch, tmp_path):
    binary = executable(tmp_path / "custom-cli")
    monkeypatch.setenv("APHRODY_LLAMA_CLI_BIN", str(binary))
    assert HarmonyRunner().cli_binary == binary


@pytest.mark.parametrize("kind", ["missing", "nonexecutable"])
def test_bad_explicit_runtime_is_reported(monkeypatch, tmp_path, kind):
    binary = tmp_path / "custom-cli"
    if kind == "nonexecutable":
        binary.write_text("not executable")
        binary.chmod(0o644)
    monkeypatch.setenv("APHRODY_LLAMA_CLI_BIN", str(binary))
    error = FileNotFoundError if kind == "missing" else PermissionError
    with pytest.raises(error, match="APHRODY_LLAMA_CLI_BIN"):
        HarmonyRunner()


def test_linux_state_directory_and_permissions(monkeypatch, tmp_path):
    monkeypatch.setenv("APHRODY_HOME", str(tmp_path))
    monkeypatch.setenv("PATH", "")
    monkeypatch.delenv("APHRODY_WHISPER_CPP_BIN", raising=False)
    candidate = tmp_path / "bin/whisper-cli"
    candidate.parent.mkdir()
    candidate.write_text("not executable")
    candidate.chmod(0o644)
    fallback = "runtimes/whisper-b4938/whisper-cli"
    assert (
        _paths.resolve_runtime_binary(
            "whisper-cli", "APHRODY_WHISPER_CPP_BIN", fallback
        )
        == tmp_path / fallback
    )
    candidate.chmod(0o755)
    assert (
        _paths.resolve_runtime_binary(
            "whisper-cli", "APHRODY_WHISPER_CPP_BIN", fallback
        )
        == candidate
    )


def test_runtime_resolution_is_dynamic(monkeypatch, tmp_path):
    monkeypatch.setenv("PATH", "")
    monkeypatch.delenv("APHRODY_LLAMA_SERVER_BIN", raising=False)
    first = tmp_path / "first"
    second = tmp_path / "second"
    monkeypatch.setenv("APHRODY_HOME", str(first))
    assert HarmonyRunner().server_binary.is_relative_to(first)
    monkeypatch.setenv("APHRODY_HOME", str(second))
    assert HarmonyRunner().server_binary.is_relative_to(second)
