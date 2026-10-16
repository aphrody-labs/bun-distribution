# SPDX-License-Identifier: Apache-2.0
import hashlib
import json
import os
import subprocess

import pytest

from aphrody_train.bun_finetune import supervised_labels
from aphrody_train.bun_specialist import build, examples


def test_loss_masking_excludes_boundary_spanning_bpe_and_special_tokens():
    assert supervised_labels(
        [10, 11, 12, 13], [(0, 0), (0, 3), (3, 7), (7, 11)], "prompt", "prompt code"
    ) == [-100, -100, -100, 13]
    with pytest.raises(ValueError, match="prefix mismatch"):
        supervised_labels([10], [(0, 3)], "other", "text")


def test_corpus_excludes_node_and_third_party_replacements():
    text = (
        "```ts\nimport axios from 'axios';\n"
        + "// filler\n" * 15
        + "console.log(Bun.version);\n```"
    )
    assert examples("docs/runtime/test.mdx", text) == []


def test_native_example_preserves_source_and_specialization_policy():
    text = "# File IO\n```ts\nconst file = Bun.file('example.txt');\nconst contents = await file.text();\nconsole.log(contents);\n```"
    rows = examples("docs/runtime/file-io.mdx", text)
    assert len(rows) == 1
    assert rows[0]["source"] == "docs/runtime/file-io.mdx"
    assert "native Bun" in rows[0]["messages"][0]["content"]


def test_corpus_uses_committed_sources_and_keeps_evaluation_disjoint(tmp_path):
    fork = tmp_path / "fork"
    fork.mkdir()
    subprocess.run(["git", "init", "-q", str(fork)], check=True)
    directory = fork / "docs/runtime"
    directory.mkdir(parents=True)
    names = {}
    for number in range(100):
        path = f"docs/runtime/native-{number}.mdx"
        split = (
            "eval"
            if int(hashlib.sha256(path.encode()).hexdigest()[:8], 16) % 5 == 0
            else "train"
        )
        names.setdefault(split, path)
    for split, path in names.items():
        (fork / path).write_text(
            f"# Files {split}\n```ts\nconst file = Bun.file('{split}.txt');\nconst contents = await file.text();\nconsole.log(contents);\n```\n"
        )
    subprocess.run(["git", "-C", str(fork), "add", "docs"], check=True)
    subprocess.run(
        [
            "git",
            "-C",
            str(fork),
            "-c",
            "user.name=test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "-qm",
            "fixture",
        ],
        check=True,
    )
    (fork / names["train"]).write_text("Uncommitted content must never enter training.")
    output = tmp_path / "corpus"
    manifest = build(fork, output)
    train = [
        json.loads(row) for row in (output / "train.jsonl").read_text().splitlines()
    ]
    evaluation = [
        json.loads(row) for row in (output / "eval.jsonl").read_text().splitlines()
    ]

    def hashes(rows):
        return {row["text_sha256"] for row in rows if "text_sha256" in row}

    assert hashes(train).isdisjoint(hashes(evaluation))
    assert manifest["splits"]["train"]["rows"] == 13
    assert "Uncommitted content" not in (output / "train.jsonl").read_text()
    if os.name == "posix":
        assert output.stat().st_mode & 0o077 == 0
    with pytest.raises(ValueError, match="new private directory"):
        build(fork, output)
