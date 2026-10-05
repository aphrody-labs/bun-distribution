# SPDX-License-Identifier: Apache-2.0
"""Rollout training sets require completion evidence and remove credentials."""

import json

from click.testing import CliRunner

from aphrody_train.dataset import extract, main, redact


def write_rollout(path, items):
    path.write_text(
        "".join(
            json.dumps({"ts": "2026-09-24T00:00:00Z", "item": item}) + "\n"
            for item in items
        ),
        encoding="utf-8",
    )


def history(role, *parts):
    return {
        "type": "history_item",
        "message": {"role": role, "parts": list(parts)},
    }


def event(kind, **fields):
    return {"id": "event-id", "msg": {"type": kind, **fields}}


def test_successful_turn_exports_redacted_chat_and_tools(tmp_path):
    path = tmp_path / "rollout-example.jsonl"
    write_rollout(
        path,
        [
            {"type": "session_meta", "payload": {"id": "private-session-id"}},
            history(
                "user",
                {"text": "Check API_KEY=top-secret-value"},
                {"image": {"url": "private"}},
            ),
            event("turn_started"),
            history(
                "model",
                {
                    "function_call": {
                        "id": "call-1",
                        "name": "shell",
                        "args": {
                            "cmd": "echo ok",
                            "access_token": "very-secret",
                        },
                    }
                },
            ),
            event("tool_call_end", call_id="call-1", ok=True),
            history(
                "tool",
                {
                    "function_response": {
                        "id": "call-1",
                        "name": "shell",
                        "response": {
                            "output": "Bearer abcdefghijklmnop",
                            "is_error": False,
                        },
                        "images": [{"base64": "private"}],
                    }
                },
            ),
            history("model", {"text": "Done."}, {"reasoning": {"text": "private"}}),
            event("turn_complete", last_agent_message="Done."),
        ],
    )
    turns, preferences = extract(path)
    assert len(turns) == 1
    assert not preferences
    content = json.dumps(turns)
    for secret in (
        "top-secret-value",
        "very-secret",
        "abcdefghijklmnop",
        "private-session-id",
        "base64",
    ):
        assert secret not in content
    assert "[REDACTED_SECRET]" in content
    assert turns[0]["messages"][-1]["role"] == "model"


def test_failed_or_interrupted_turn_is_not_a_successful_rollout(tmp_path):
    path = tmp_path / "rollout-failed.jsonl"
    write_rollout(
        path,
        [
            {"type": "session_meta", "payload": {"id": "session"}},
            history("user", {"text": "Patch file"}),
            event("turn_started"),
            event("error", message="model failed"),
            history("model", {"text": "Partial"}),
            event("turn_complete", last_agent_message="Partial"),
            history("user", {"text": "Try again"}),
            event("turn_started"),
            history("model", {"text": "Unfinished"}),
        ],
    )
    assert extract(path) == ([], [])


def test_dpo_requires_repaired_same_tool_call(tmp_path):
    path = tmp_path / "rollout-repair.jsonl"
    write_rollout(
        path,
        [
            {"type": "session_meta", "payload": {"id": "session"}},
            history("user", {"text": "Apply the fix"}),
            event("turn_started"),
            history(
                "model",
                {
                    "function_call": {
                        "id": "bad",
                        "name": "apply_patch",
                        "args": {"patch": "bad patch"},
                    }
                },
            ),
            event("tool_call_end", call_id="bad", ok=False),
            history(
                "tool",
                {
                    "function_response": {
                        "id": "bad",
                        "name": "apply_patch",
                        "response": {
                            "output": "patch failed",
                            "is_error": True,
                        },
                    }
                },
            ),
            history(
                "model",
                {
                    "function_call": {
                        "id": "good",
                        "name": "apply_patch",
                        "args": {"patch": "good patch"},
                    }
                },
            ),
            event("tool_call_end", call_id="good", ok=True),
            history(
                "tool",
                {
                    "function_response": {
                        "id": "good",
                        "name": "apply_patch",
                        "response": {"output": "applied", "is_error": False},
                    }
                },
            ),
            history("model", {"text": "Fixed."}),
            event("turn_complete", last_agent_message="Fixed."),
        ],
    )
    turns, preferences = extract(path)
    assert not turns  # Failed tool calls must not be labeled successful SFT turns.
    assert len(preferences) == 1
    assert json.loads(preferences[0]["chosen"])["args"]["patch"] == "good patch"
    assert json.loads(preferences[0]["rejected"])["args"]["patch"] == "bad patch"


def test_cli_refuses_empty_dataset_without_artifact(tmp_path):
    rollout_dir = tmp_path / "rollouts"
    rollout_dir.mkdir()
    output_dir = tmp_path / "output"
    gold = tmp_path / "gold.jsonl"
    gold.write_text(
        '{"q":"reserved evaluation prompt","expectUrl":["https://gold.example"]}\n',
        encoding="utf-8",
    )
    result = CliRunner().invoke(
        main,
        [
            "rollouts",
            "--rollout-dir",
            str(rollout_dir),
            "--output-dir",
            str(output_dir),
            "--gold-file",
            str(gold),
        ],
    )
    assert result.exit_code != 0
    events = [
        json.loads(line) for line in result.output.splitlines() if line.startswith("{")
    ]
    assert [item["type"] for item in events] == ["start", "error"]
    assert not output_dir.exists()


def test_redaction_handles_nested_keys_and_urls():
    value = redact(
        {
            "credentials": {"token": "abc"},
            "text": "https://user:password@example.org x",
        }
    )
    assert "password" not in json.dumps(value)
    assert value["credentials"] == "[REDACTED_SECRET]"


def test_cli_gold_guard_excludes_matching_turn(tmp_path):
    rollout_dir = tmp_path / "rollouts"
    rollout_dir.mkdir()
    write_rollout(
        rollout_dir / "rollout-gold.jsonl",
        [
            {"type": "session_meta", "payload": {"id": "session"}},
            history("user", {"text": "reserved evaluation prompt"}),
            event("turn_started"),
            history("model", {"text": "An answer."}),
            event("turn_complete", last_agent_message="An answer."),
        ],
    )
    gold = tmp_path / "gold.jsonl"
    gold.write_text(
        '{"q":"reserved evaluation prompt","expectUrl":["https://gold.example"]}\n',
        encoding="utf-8",
    )
    output = tmp_path / "output"
    result = CliRunner().invoke(
        main,
        [
            "rollouts",
            "--rollout-dir",
            str(rollout_dir),
            "--output-dir",
            str(output),
            "--gold-file",
            str(gold),
        ],
    )
    assert result.exit_code != 0
    assert not output.exists()


def test_cli_exports_completed_rollout_with_artifact_digest(tmp_path):
    rollout_dir = tmp_path / "rollouts"
    rollout_dir.mkdir()
    write_rollout(
        rollout_dir / "rollout-complete.jsonl",
        [
            {"type": "session_meta", "payload": {"id": "session"}},
            history("user", {"text": "Explain the code"}),
            event("turn_started"),
            history("model", {"text": "The code reads a file."}),
            event("turn_complete", last_agent_message="The code reads a file."),
        ],
    )
    gold = tmp_path / "gold.jsonl"
    gold.write_text('{"query":"unrelated gold case"}\n', encoding="utf-8")
    output = tmp_path / "output"
    result = CliRunner().invoke(
        main,
        [
            "rollouts",
            "--rollout-dir",
            str(rollout_dir),
            "--output-dir",
            str(output),
            "--gold-file",
            str(gold),
        ],
    )
    assert result.exit_code == 0, result.output
    payload = (output / "rollouts.jsonl").read_bytes()
    assert json.loads(payload)["prompt"] == "Explain the code"
    events = [
        json.loads(line) for line in result.output.splitlines() if line.startswith("{")
    ]
    assert [item["type"] for item in events] == ["start", "artifact", "done"]
    import hashlib

    assert events[1]["sha256"] == hashlib.sha256(payload).hexdigest()
