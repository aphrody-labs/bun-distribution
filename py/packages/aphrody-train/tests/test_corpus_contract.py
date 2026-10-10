# SPDX-License-Identifier: Apache-2.0
"""Malformed corpus inputs must not silently become incomplete training data."""

import pytest

from aphrody_train import load_multimodal_corpus


@pytest.mark.parametrize("row", ["not JSON", "[]", "null"])
def test_bad_corpus_reports_file_and_line(tmp_path, row):
    corpus = tmp_path / "corpus.jsonl"
    corpus.write_text(row + "\n", encoding="utf-8")
    with pytest.raises(ValueError, match="corpus.jsonl at line 1"):
        load_multimodal_corpus(str(corpus))


def test_valid_corpus_api_does_not_emit_cli_progress(tmp_path, capsys):
    corpus = tmp_path / "corpus.jsonl"
    corpus.write_text(
        '{"id":"one","title":"Report","content":"A finding"}\n', encoding="utf-8"
    )
    assert load_multimodal_corpus(str(corpus))[0].doc_id == "one"
    assert capsys.readouterr().out == ""
