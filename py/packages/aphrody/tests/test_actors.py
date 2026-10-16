"""The Python Actor surface follows the BXC JSON CLI contract."""

import json
import subprocess
from pathlib import Path

import pytest

from aphrody.actors import ActorClient, ActorError, list_actors, run_actor


def test_actor_list_and_run_use_structured_cli(monkeypatch, tmp_path):
    calls = []

    def fake_run(argv, **kwargs):
        calls.append((argv, kwargs))
        if argv[2] == "list":
            body = [{"name": "x-profile", "path": str(tmp_path / "x"), "title": "X"}]
        else:
            input_file = argv[argv.index("--input-file") + 1]
            assert json.loads(Path(input_file).read_text(encoding="utf-8")) == {
                "url": "https://example.com"
            }
            body = {
                "actor": "x-profile",
                "storageDir": str(tmp_path),
                "output": {"ok": True},
            }
        return subprocess.CompletedProcess(argv, 0, json.dumps(body), "")

    monkeypatch.setattr(subprocess, "run", fake_run)
    actors = list_actors(web_browser_bin="bxc-test")
    result = run_actor(
        "x-profile",
        input={"url": "https://example.com"},
        storage_dir=tmp_path,
        purge=False,
        web_browser_bin="bxc-test",
    )
    assert actors[0].name == "x-profile"
    assert result.output == {"ok": True}
    assert calls[0][0] == ["bxc-test", "actor", "list", "--json"]
    assert calls[1][0][-2:] == ["--no-purge", "--json"]
    assert "https://example.com" not in " ".join(calls[1][0])
    assert not Path(calls[1][0][calls[1][0].index("--input-file") + 1]).exists()
    assert calls[1][1]["timeout"] == 300


def test_actor_failure_does_not_expose_input(monkeypatch, tmp_path):
    def fake_run(argv, **kwargs):
        return subprocess.CompletedProcess(argv, 65, "secret-value", "secret-value")

    monkeypatch.setattr(subprocess, "run", fake_run)
    with pytest.raises(ActorError, match="code 65") as failure:
        run_actor(
            "x-profile",
            input={"token": "secret-value"},
            storage_dir=tmp_path,
            web_browser_bin="bxc-test",
        )
    assert "secret-value" not in str(failure.value)


def test_actor_client_configuration_reused_for_list_and_run(monkeypatch, tmp_path):
    calls = []

    def fake_run(argv, **kwargs):
        calls.append((argv, kwargs))
        if argv[2] == "list":
            body = [{"name": "test", "path": str(tmp_path)}]
        else:
            body = {"actor": "test", "storageDir": str(tmp_path), "output": 7}
        return subprocess.CompletedProcess(argv, 0, json.dumps(body), "")

    monkeypatch.setattr(subprocess, "run", fake_run)
    client = ActorClient(
        web_browser_bin="aphrody-test", timeout=45, discovery_timeout=5
    )
    assert client.list()[0].name == "test"
    assert client.run("test", storage_dir=tmp_path).output == 7
    assert [call[0][0] for call in calls] == ["aphrody-test", "aphrody-test"]
    assert [call[1]["timeout"] for call in calls] == [5, 45]
    assert all(call[1]["encoding"] == "utf-8" for call in calls)


@pytest.mark.parametrize("failure", ["input", "launch", "response"])
def test_failed_actor_removes_owned_storage(monkeypatch, tmp_path, failure):
    from aphrody import actors

    storage = tmp_path / "owned"
    storage.mkdir()
    monkeypatch.setattr(actors.tempfile, "mkdtemp", lambda **kwargs: str(storage))

    def fake_run(argv, **kwargs):
        if failure == "launch":
            raise FileNotFoundError("missing executable")
        return subprocess.CompletedProcess(argv, 0, "{}", "")

    monkeypatch.setattr(subprocess, "run", fake_run)
    actor_input = {"invalid": object()} if failure == "input" else None
    with pytest.raises(ActorError):
        run_actor("test", input=actor_input, web_browser_bin="aphrody-test")
    assert not storage.exists()


def test_failed_actor_preserves_caller_storage(monkeypatch, tmp_path):
    marker = tmp_path / "keep.txt"
    marker.write_text("caller data")

    def fake_run(argv, **kwargs):
        raise FileNotFoundError("missing executable")

    monkeypatch.setattr(subprocess, "run", fake_run)
    with pytest.raises(ActorError):
        run_actor("test", storage_dir=tmp_path, web_browser_bin="aphrody-test")
    assert marker.read_text() == "caller data"


def test_successful_actor_preserves_owned_storage(monkeypatch, tmp_path):
    from aphrody import actors

    storage = tmp_path / "owned"
    storage.mkdir()
    monkeypatch.setattr(actors.tempfile, "mkdtemp", lambda **kwargs: str(storage))

    def fake_run(argv, **kwargs):
        body = {"actor": "test", "storageDir": str(storage)}
        return subprocess.CompletedProcess(argv, 0, json.dumps(body), "")

    monkeypatch.setattr(subprocess, "run", fake_run)
    result = run_actor("test", web_browser_bin="aphrody-test")
    assert result.storage_dir == storage
    assert storage.is_dir()


@pytest.mark.parametrize("timeout", [0, -1, float("nan"), float("inf")])
def test_invalid_timeout_has_no_storage_side_effects(monkeypatch, timeout):
    from aphrody import actors

    def unexpected_directory(**kwargs):
        pytest.fail("invalid configuration created storage")

    monkeypatch.setattr(actors.tempfile, "mkdtemp", unexpected_directory)
    with pytest.raises(ValueError, match="finite and positive"):
        run_actor("test", timeout=timeout)
    with pytest.raises(ValueError, match="finite and positive"):
        ActorClient(timeout=timeout)
