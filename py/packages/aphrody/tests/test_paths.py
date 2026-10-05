# SPDX-License-Identifier: Apache-2.0
"""Tests for :mod:`aphrody._paths`."""

from __future__ import annotations

from pathlib import Path

import pytest

from aphrody import _paths


def test_env_override(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("APHRODY_SECRETS_DIR", str(tmp_path))
    assert _paths.secrets_dir() == tmp_path
    assert _paths.secret_file("x.json") == tmp_path / "x.json"


def test_repo_var_secrets(monkeypatch, tmp_path) -> None:
    monkeypatch.delenv("APHRODY_SECRETS_DIR", raising=False)
    (tmp_path / ".git").mkdir()
    monkeypatch.chdir(tmp_path)
    assert _paths.secrets_dir() == tmp_path / "var" / "secrets"


def test_fallback_to_home(monkeypatch, tmp_path) -> None:
    monkeypatch.delenv("APHRODY_SECRETS_DIR", raising=False)
    monkeypatch.delenv("APHRODY_HOME", raising=False)
    monkeypatch.setattr(Path, "home", lambda: tmp_path / "home")
    sub = tmp_path / "no-repo-here"
    sub.mkdir()
    monkeypatch.chdir(sub)
    # tmp_path has no .git ancestor, so resolution falls back to ~/.aphrody.
    assert _paths.secrets_dir() == Path.home() / ".aphrody"


@pytest.mark.parametrize("platform", ["linux", "darwin", "win32"])
def test_native_executable_names(platform):
    expected = "runtime.exe" if platform == "win32" else "runtime"
    assert _paths.executable_name("runtime", platform=platform) == expected
    assert _paths.executable_name("runtime.exe", platform=platform) == "runtime.exe"


def test_windows_state_runtime_discovery(monkeypatch, tmp_path):
    monkeypatch.setenv("APHRODY_HOME", str(tmp_path / "relocated state"))
    monkeypatch.delenv("APHRODY_TEST_RUNTIME", raising=False)
    monkeypatch.setattr(_paths.shutil, "which", lambda _name: None)
    monkeypatch.setattr(
        _paths,
        "executable_name",
        lambda name: name if name.endswith(".exe") else name + ".exe",
    )
    binary = tmp_path / "relocated state" / "bin" / "runtime.exe"
    binary.parent.mkdir(parents=True)
    binary.write_text("synthetic executable")
    binary.chmod(0o755)
    assert (
        _paths.resolve_runtime_binary(
            "runtime", "APHRODY_TEST_RUNTIME", "runtimes/runtime"
        )
        == binary
    )


def test_explicit_runtime_expands_home_and_never_falls_back(monkeypatch, tmp_path):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HOME", str(tmp_path))
    binary = tmp_path / "custom runtime"
    binary.write_text("synthetic executable")
    binary.chmod(0o755)
    assert (
        _paths.resolve_executable("runtime", "~/custom runtime", "TEST_BIN") == binary
    )
    with pytest.raises(FileNotFoundError, match="TEST_BIN"):
        _paths.resolve_executable("runtime", str(tmp_path / "missing"), "TEST_BIN")


def test_session_database_resolves_state_override_at_construction(
    monkeypatch, tmp_path
):
    from aphrody.session_db import SessionDB

    for location in (tmp_path / "first", tmp_path / "relocated home"):
        monkeypatch.setenv("APHRODY_HOME", str(location))
        database = SessionDB()
        try:
            assert database.db_path == location / "sessions" / "sessions.db"
        finally:
            database.close()
