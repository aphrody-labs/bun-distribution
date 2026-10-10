from pathlib import Path

from aphrody import google_cli


def test_resolve_binary_prefers_configured_existing_path(
    monkeypatch, tmp_path: Path
) -> None:
    binary = tmp_path / "google"
    binary.write_bytes(b"stub")
    binary.chmod(0o755)
    monkeypatch.setenv("APHRODY_GOOGLE_BIN", str(binary))

    assert google_cli._resolve_binary() == str(binary)


def test_resolve_binary_falls_back_to_aphrody_home(monkeypatch, tmp_path: Path) -> None:
    binary = tmp_path / ".aphrody" / "bin" / "aphrody-google"
    binary.parent.mkdir(parents=True)
    binary.write_bytes(b"stub")
    binary.chmod(0o755)
    monkeypatch.delenv("APHRODY_GOOGLE_BIN", raising=False)
    monkeypatch.delenv("APHRODY_HOME", raising=False)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setattr(google_cli.shutil, "which", lambda _: None)

    assert google_cli._resolve_binary() == str(binary)


def test_nonexecutable_override_does_not_select_another_binary(monkeypatch, tmp_path):
    binary = tmp_path / "configured-google"
    binary.write_text("not executable")
    binary.chmod(0o644)
    monkeypatch.setenv("APHRODY_GOOGLE_BIN", str(binary))
    monkeypatch.setattr(google_cli.shutil, "which", lambda _: "/usr/bin/another-google")
    assert google_cli._resolve_binary() is None


def test_linux_discovery_does_not_select_windows_executable(monkeypatch, tmp_path):
    binary = tmp_path / "bin/aphrody-google.exe"
    binary.parent.mkdir()
    binary.write_text("windows binary")
    binary.chmod(0o755)
    monkeypatch.setenv("APHRODY_HOME", str(tmp_path))
    monkeypatch.delenv("APHRODY_GOOGLE_BIN", raising=False)
    monkeypatch.setattr(google_cli.shutil, "which", lambda _: None)
    assert google_cli._resolve_binary() is None
