# SPDX-License-Identifier: Apache-2.0
import hashlib
import json
import unicodedata

from click.testing import CliRunner

from aphrody_train.hashing import (
    hash_gold_row,
    main,
    normalize_text,
    normalize_url,
    segment_hashes,
    text_sha256,
)


def test_normalisation_is_nfc_and_collapses_whitespace():
    decomposed = unicodedata.normalize("NFD", "Café  au\tlait\n")
    assert normalize_text(decomposed) == "Café au lait"
    assert text_sha256(decomposed) == text_sha256("Café au lait")
    expected = hashlib.sha256("Café au lait".encode()).hexdigest()
    assert text_sha256("  Café au   lait ") == expected


def test_casefold_is_optional():
    assert text_sha256("Goku") != text_sha256("GOKU")
    assert text_sha256("Goku", casefold=True) == text_sha256("GOKU", casefold=True)
    # German sharp s folds to "ss" only with casefold.
    assert text_sha256("Straße", casefold=True) == text_sha256("STRASSE", casefold=True)


def test_url_normalisation_drops_fragment_and_trailing_slash():
    assert normalize_url("HTTPS://Example.com/Page/#top") == "https://example.com/page"


def test_segments_match_a_sentence_inside_a_longer_text():
    gold = segment_hashes("How does the GPU lease work?")
    row = segment_hashes("Context first. How does the GPU lease work? Thanks.")
    assert gold & row
    assert not segment_hashes("How does the CPU lease work?") & gold


def test_gold_rows_gain_additive_hashes(tmp_path):
    row = {"q": "Who trained Goku?", "expectUrl": ["https://x.example/a"]}
    hashed = hash_gold_row(row)
    assert hashed["q"] == row["q"]
    assert hashed["text_sha256"] == text_sha256("Who trained Goku?")
    assert len(hashed["target_sha256"]) == 1

    source = tmp_path / "gold.jsonl"
    source.write_text(json.dumps(row) + "\n", encoding="utf-8")
    output = tmp_path / "gold.hashed.jsonl"
    result = CliRunner().invoke(
        main, ["gold", "--gold-file", str(source), "--output", str(output)]
    )
    assert result.exit_code == 0, result.output
    events = [json.loads(line) for line in result.output.splitlines()]
    assert [event["type"] for event in events] == ["start", "artifact", "done"]
    assert events[1]["sha256"] == hashlib.sha256(output.read_bytes()).hexdigest()
    assert json.loads(output.read_text())["text_sha256"] == hashed["text_sha256"]
