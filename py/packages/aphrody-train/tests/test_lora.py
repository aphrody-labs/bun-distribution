# SPDX-License-Identifier: Apache-2.0
"""LoRA input guards reject unsafe or incomplete data before model output exists."""

import json

import pytest
from click.testing import CliRunner

from aphrody_train.lora import load_examples, main, validate_converter


def prepared(tmp_path, prompt="Name one planet.", answer="Mars is a planet."):
    source = tmp_path / "prepared"
    source.mkdir()
    row = {
        "session": "synthetic",
        "prompt": prompt,
        "messages": [
            {"role": "user", "parts": [{"text": prompt}]},
            {"role": "model", "parts": [{"text": answer}]},
        ],
    }
    (source / "rollouts.jsonl").write_text(json.dumps(row) + "\n", encoding="utf-8")
    gold = tmp_path / "gold.jsonl"
    gold.write_text('{"q":"untouched gold query"}\n', encoding="utf-8")
    return source, gold


def test_prepared_rollouts_recheck_gold_and_redact_secrets(tmp_path):
    source, gold = prepared(tmp_path, answer="Use token=private-value in this demo.")
    examples = load_examples(source, gold)
    assert examples == [("Name one planet.", "Use [REDACTED_SECRET] in this demo.")]
    gold.write_text('{"q":"Name one planet."}\n', encoding="utf-8")
    with pytest.raises(ValueError, match="overlaps untouched gold"):
        load_examples(source, gold)


def test_missing_converter_fails_before_creating_output(tmp_path, monkeypatch):
    source, gold = prepared(tmp_path)
    model = tmp_path / "model"
    model.mkdir()
    (model / "config.json").write_text("{}", encoding="utf-8")
    monkeypatch.delenv("APHRODY_LLAMA_CPP_CONVERTER", raising=False)
    output = tmp_path / "output"
    result = CliRunner().invoke(
        main,
        [
            "--rollout-dir",
            str(source),
            "--gold-file",
            str(gold),
            "--base-model",
            str(model),
            "--output-dir",
            str(output),
            "--steps",
            "1",
        ],
    )
    assert result.exit_code != 0
    events = [
        json.loads(line) for line in result.output.splitlines() if line.startswith("{")
    ]
    assert [event["type"] for event in events] == ["start", "error"]
    assert not output.exists()
    with pytest.raises(ValueError, match="APHRODY_LLAMA_CPP_CONVERTER"):
        validate_converter(tmp_path / "missing.py")
