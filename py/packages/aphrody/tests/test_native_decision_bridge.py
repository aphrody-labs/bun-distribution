# SPDX-License-Identifier: Apache-2.0
"""Product JSON/lifetime fixtures and explicit native SDK gate; no provider calls."""

import hashlib
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from aphrody.decision.native_bridge import decide_bun_json


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def inputs():
    return {
        "goal": "Read the supplied synthetic catalogue",
        "actions": [
            {"id": "read", "description": "Read source"},
            {"id": "search", "description": "Search graph"},
        ],
        "model": "synthetic-fixture",
        "minimum_confidence": 0.8,
        "deadline_seconds": 5.0,
    }


def raw(usage):
    return {
        "model": "synthetic-fixture",
        "usage": usage,
        "answers": {
            "action": {
                "type": "choice",
                "choice": "read",
                "confidence": 0.6,
                "probabilities": {"read": 0.6, "search": 0.4},
            }
        },
    }


def envelope(directory, executable, usage=None):
    return {
        "protocol": "aphrody.yolo.bun-bridge/1",
        "argument": json.dumps(inputs()),
        "runtime": {
            "directory": str(directory),
            "manifestSha256": digest(directory / "manifest.json"),
        },
        "bun": {
            "executable": str(executable),
            "sha256": digest(executable),
            "revision": "a" * 40,
        },
        "provider": {"kind": "code", "response": raw(usage)},
    }


@pytest.fixture
def pinned(tmp_path):
    (tmp_path / "manifest.json").write_text('{"synthetic":true}')
    executable = tmp_path / "bun.exe"
    executable.write_bytes(b"synthetic fixture only, never executed")
    return envelope(tmp_path, executable)


def install_fixture(
    monkeypatch, response, events, *, failure=None, inference_failure=None
):
    class Runtime:
        def __init__(self, directory, *, max_operations):
            assert directory.is_absolute() and max_operations == 1
            events.append("runtime-open")

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            events.append("runtime-close")

    class Yolo:
        def __init__(self, runtime, executable, **options):
            assert runtime is not None and executable.is_absolute()
            assert options["revision"] == "a" * 40
            events.append("client-borrow")
            if failure:
                raise failure

        def inspect(self, state, questions, **options):
            assert set(questions) == {"action"}
            assert state["goal"] == inputs()["goal"]
            assert options["minimum_confidence"] == 0.8
            assert options["options"]["maxRetries"] == 0
            if inference_failure:
                raise inference_failure
            return response

    monkeypatch.setitem(sys.modules, "yolo_runtime", SimpleNamespace(Runtime=Runtime))
    monkeypatch.setitem(sys.modules, "bun_yolo", SimpleNamespace(Yolo=Yolo))


@pytest.mark.parametrize("usage", [None, {"input_tokens": 12, "output_tokens": 3}])
def test_scoped_sdk_borrow_preserves_native_selection_and_usage(
    monkeypatch, pinned, usage
):
    events = []
    response = {**raw(usage), "selections": {"action": None}}
    install_fixture(monkeypatch, response, events)
    result = json.loads(decide_bun_json(json.dumps(pinned)))
    assert result["action_id"] is None and result["candidate"] == "read"
    assert result["usage"] == usage and result["executed"] is False
    assert events == ["runtime-open", "client-borrow", "runtime-close"]


def test_bad_hash_refuses_before_sdk_activation(monkeypatch, pinned):
    events = []
    install_fixture(monkeypatch, {}, events)
    pinned["bun"]["sha256"] = "0" * 64
    with pytest.raises(ValueError, match="ERR_DECISION_ARTIFACT_HASH"):
        decide_bun_json(json.dumps(pinned))
    assert events == []


def test_client_activation_failure_closes_owned_runtime(monkeypatch, pinned):
    events = []
    failure = RuntimeError("synthetic missing process.stdin capability")
    install_fixture(monkeypatch, {}, events, failure=failure)
    with pytest.raises(RuntimeError, match="process.stdin"):
        decide_bun_json(json.dumps(pinned))
    assert events == ["runtime-open", "client-borrow", "runtime-close"]


def test_deadline_error_remains_explicit_and_closes_owned_runtime(monkeypatch, pinned):
    events = []
    install_fixture(monkeypatch, {}, events, inference_failure=TimeoutError())
    with pytest.raises(TimeoutError, match="ERR_DECISION_DEADLINE"):
        decide_bun_json(json.dumps(pinned))
    assert events == ["runtime-open", "client-borrow", "runtime-close"]


def test_bridge_rejects_oversized_utf8_before_any_pin_lookup():
    with pytest.raises(ValueError, match="ERR_DECISION_INPUT_LIMIT"):
        decide_bun_json("😀" * 300_000)


@pytest.mark.skipif(
    os.environ.get("BUN_YOLO_NATIVE_GATE") != "1",
    reason="Qualified native SDK/Bun not selected",
)
@pytest.mark.parametrize("usage", [None, {"input_tokens": 12, "output_tokens": 3}])
def test_real_sdk_owns_one_scoped_graph_operation(usage):
    from yolo_runtime import artifact_directory

    value = envelope(
        artifact_directory(), Path(os.environ["BUN_YOLO_EXECUTABLE"]), usage
    )
    value["bun"]["revision"] = os.environ["BUN_YOLO_REVISION"]
    result = json.loads(decide_bun_json(json.dumps(value)))
    assert result["action_id"] is None and result["status"] == "abstained"
    assert result["confidence"] == 0.6 and result["probabilities"] == {
        "read": 0.6,
        "search": 0.4,
    }
    assert result["usage"] == usage and result["executed"] is False
