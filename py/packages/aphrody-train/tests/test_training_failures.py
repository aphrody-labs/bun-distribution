# SPDX-License-Identifier: Apache-2.0
"""Training commands must never report artifacts or success without a model."""

import builtins
import json

from click.testing import CliRunner

from aphrody_train.dry_run import main as dry_run_main
from aphrody_train.embed import main as embed_main
from aphrody_train.lora import main as lora_main
from aphrody_train.rerank import main as rerank_main
from aphrody_train.training_data import load_triples
from aphrody_train.triples import main as triples_main


def events(result):
    return [
        json.loads(line) for line in result.output.splitlines() if line.startswith("{")
    ]


def test_triples_require_real_nonempty_rows(tmp_path):
    source = tmp_path / "triples.jsonl"
    source.write_text('{"query":"q","positive":"p","negative":""}\n', encoding="utf-8")
    try:
        load_triples(str(source))
    except ValueError as exc:
        assert "nonempty query, positive and negative" in str(exc)
    else:
        raise AssertionError("invalid triples accepted")


def test_embed_and_rerank_fail_without_data_and_no_artifact(tmp_path):
    for command in (embed_main, rerank_main):
        result = CliRunner().invoke(
            command,
            [
                "--triples-file",
                str(tmp_path / "missing.jsonl"),
                "--output-dir",
                str(tmp_path / "out"),
            ],
        )
        assert result.exit_code != 0
        assert [event["type"] for event in events(result)] == ["start", "error"]
        assert not (tmp_path / "out").exists()


def test_embed_and_rerank_fail_without_training_dependencies(tmp_path, monkeypatch):
    source = tmp_path / "triples.jsonl"
    source.write_text(
        '{"query":"question one","positive":"passage one","negative":"wrong one"}\n'
        '{"query":"question two","positive":"passage two","negative":"wrong two"}\n',
        encoding="utf-8",
    )
    original_import = builtins.__import__

    def missing_datasets(name, *args, **kwargs):
        if name == "datasets":
            raise ImportError("datasets unavailable")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", missing_datasets)
    for command in (embed_main, rerank_main):
        output = tmp_path / command.name
        result = CliRunner().invoke(
            command,
            ["--triples-file", str(source), "--output-dir", str(output)],
        )
        assert result.exit_code != 0
        assert [event["type"] for event in events(result)] == ["start", "error"]
        assert "--extra full" in result.output
        assert "datasets unavailable" in result.output
        assert not output.exists()


def test_lora_explicitly_fails_without_creating_weights(tmp_path):
    output = tmp_path / "out"
    result = CliRunner().invoke(
        lora_main,
        [
            "--rollout-dir",
            str(tmp_path),
            "--gold-file",
            str(tmp_path / "missing-gold.jsonl"),
            "--base-model",
            str(tmp_path / "missing-model"),
            "--output-dir",
            str(output),
        ],
    )
    assert result.exit_code != 0
    assert [event["type"] for event in events(result)] == ["start", "error"]
    assert not output.exists()


def test_dry_run_fails_without_dependencies_and_creates_no_model(tmp_path, monkeypatch):
    original_import = builtins.__import__

    def missing_datasets(name, *args, **kwargs):
        if name == "datasets":
            raise ImportError("datasets unavailable")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", missing_datasets)
    output = tmp_path / "out"
    result = CliRunner().invoke(dry_run_main, ["--output-dir", str(output)])
    assert result.exit_code != 0
    assert [event["type"] for event in events(result)] == ["start", "error"]
    assert not output.exists()


def test_triples_command_rejects_missing_source_or_gold(tmp_path):
    output = tmp_path / "triples.jsonl"
    result = CliRunner().invoke(
        triples_main,
        [
            "--input-chunks",
            str(tmp_path / "missing.jsonl"),
            "--output-triples",
            str(output),
        ],
    )
    assert result.exit_code != 0
    assert [event["type"] for event in events(result)] == ["start", "error"]
    assert not output.exists()

    chunks = tmp_path / "chunks.jsonl"
    chunks.write_text(
        '{"text":"A valid passage with more than thirty characters for training."}\n'
        '{"text":"Another distinct passage with more than thirty characters."}\n',
        encoding="utf-8",
    )
    result = CliRunner().invoke(
        triples_main,
        [
            "--input-chunks",
            str(chunks),
            "--output-triples",
            str(output),
            "--gold-file",
            str(tmp_path / "missing-gold.jsonl"),
        ],
    )
    assert result.exit_code != 0
    assert [event["type"] for event in events(result)] == ["start", "error"]
    assert not output.exists()
