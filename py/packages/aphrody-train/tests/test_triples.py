# SPDX-License-Identifier: Apache-2.0
import builtins
import json

import pytest
from click.testing import CliRunner

from aphrody_train.hashing import text_sha256
from aphrody_train.negatives import MiningUnavailableError, choose, positional
from aphrody_train.triples import (
    TriplesOptions,
    build_triples,
    generate_triples,
    is_gold_leak,
    main,
)


def events(result):
    return [
        json.loads(line) for line in result.output.splitlines() if line.startswith("{")
    ]


def test_gold_leak_detection():
    gold_queries = {"how does gpu lease work?"}
    gold_urls = {"https://example.com/gpu"}

    assert is_gold_leak(
        "How does GPU lease work?", "Some passage", gold_queries, gold_urls
    )
    assert is_gold_leak(
        "Another query",
        "See https://example.com/gpu/details",
        gold_queries,
        gold_urls,
    )
    assert not is_gold_leak(
        "Completely unrelated query", "Different text", gold_queries, gold_urls
    )


CHUNKS = [
    {
        "id": "1",
        "text": "This is a clean and regular chunk of text for testing.",
    },
    {
        "id": "2",
        "text": "Leak query sentence. It should be filtered by the gold guard.",
    },
    {
        "id": "3",
        "text": "Another clean chunk that should produce valid triples.",
    },
]


def test_generate_triples_filters_hash_leaks(tmp_path):
    gold_path = tmp_path / "gold.jsonl"
    gold_path.write_text(
        json.dumps({"query": "leak query sentence", "expected_url": "http://leak.com"})
        + "\n",
        encoding="utf-8",
    )
    triples, leaks = generate_triples(
        CHUNKS, str(gold_path), options=TriplesOptions(negatives="positional")
    )
    assert leaks == 1
    assert {t["chunk_id"] for t in triples} == {"1", "3"}
    for t in triples:
        assert t["text_sha256"] == text_sha256(t["query"])
        assert t["positive_sha256"] == text_sha256(t["positive"])
        assert t["negative_sha256"] == text_sha256(t["negative"])
        assert t["split"] == "train"
        assert t["negative"] != t["positive"]
        # Leaked passages are not reused as negatives either.
        assert "Leak query" not in t["negative"]


def test_legacy_substring_option_keeps_former_behaviour(tmp_path):
    gold_path = tmp_path / "gold.jsonl"
    gold_path.write_text('{"query": "be filtered by the gold"}\n', encoding="utf-8")
    hashed, leaks = generate_triples(
        CHUNKS, str(gold_path), options=TriplesOptions(negatives="positional")
    )
    assert leaks == 0 and len(hashed) == 3
    legacy, leaks = generate_triples(
        CHUNKS,
        str(gold_path),
        options=TriplesOptions(negatives="positional", legacy_substring_guard=True),
    )
    assert leaks == 1 and len(legacy) == 2


def test_exact_duplicates_are_dropped_and_counted():
    chunks = [
        {"id": "a", "text": "Duplicate passage with enough characters in it."},
        {"id": "b", "text": "duplicate  PASSAGE with enough characters in it."},
        {"id": "c", "text": "A third distinct passage that has enough text."},
    ]
    result = build_triples(
        chunks, None, TriplesOptions(negatives="positional", near_dup="off")
    )
    assert result.stats["exact_duplicates"] == 1
    assert [row["chunk_id"] for row in result.rows] == ["a", "c"]


def test_positional_strategy_skips_same_document():
    excluded = {(0, 2), (2, 0)}
    choices = positional(4, lambda i, j: (i, j) in excluded)
    # (0 + 2) % 4 == 2 is the same document, so the next position is used.
    assert choices == [3, 3, 1, 1]
    assert positional(2, lambda i, j: True) == [None, None]


def missing_sentence_transformers(monkeypatch):
    original_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name.startswith(("sentence_transformers", "datasets")):
            raise ImportError(f"{name} unavailable")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)


def test_auto_falls_back_to_positional_without_mining_dependencies(monkeypatch):
    missing_sentence_transformers(monkeypatch)
    result = build_triples(CHUNKS, None, TriplesOptions(near_dup="off"))
    assert result.stats["negative_strategy"] == "positional"
    assert "unavailable" in result.stats["negative_fallback_reason"]
    assert result.stats["negatives_positional"] == 3
    assert {row["negative_strategy"] for row in result.rows} == {"positional"}


def test_explicit_mining_fails_closed_without_dependencies(monkeypatch):
    missing_sentence_transformers(monkeypatch)
    with pytest.raises(MiningUnavailableError):
        build_triples(CHUNKS, None, TriplesOptions(negatives="mined", near_dup="off"))


def doc_chunks():
    return [
        {
            "id": "a1",
            "doc_id": "A",
            "text": "Goku trains under Master Roshi on the island.",
        },
        {
            "id": "a2",
            "doc_id": "A",
            "text": "Roshi teaches Goku the Kamehameha wave technique.",
        },
        {
            "id": "b1",
            "doc_id": "B",
            "text": "Vegeta arrives on Earth with Nappa to fight.",
        },
        {
            "id": "c1",
            "doc_id": "C",
            "text": "Bulma builds a radar to find the dragon balls.",
        },
    ]


def test_mined_negatives_exclude_same_document_and_keep_rank_order():
    chunks = doc_chunks()
    calls = []

    def fake_miner(pairs, corpus, config):
        calls.append((pairs, corpus, config))
        assert config.range_max == 50 and config.max_score == 0.8
        assert config.relative_margin == 0.05 and config.sampling_strategy == "top"
        ranked = {
            0: [
                (chunks[1]["text"], 0.79),
                (chunks[2]["text"], 0.6),
                (chunks[3]["text"], 0.5),
            ],
            1: [(chunks[0]["text"], 0.78), (chunks[3]["text"], 0.4)],
            2: [(chunks[3]["text"], 0.3)],
            3: [],
        }
        return [ranked[i] for i in range(len(pairs))]

    result = build_triples(
        chunks,
        None,
        TriplesOptions(negatives="mined", near_dup="off", miner=fake_miner),
    )
    assert len(calls) == 1
    by_id = {row["chunk_id"]: row for row in result.rows}
    # Same-document candidate a2 is skipped for a1; the next ranked one wins.
    assert by_id["a1"]["negative"] == chunks[2]["text"]
    assert by_id["a1"]["negative_strategy"] == "mined"
    assert by_id["a1"]["negative_score"] == 0.6
    assert by_id["a2"]["negative"] == chunks[3]["text"]
    assert by_id["b1"]["negative"] == chunks[3]["text"]
    # No mined candidate left: positional fill, never the same document.
    assert by_id["c1"]["negative_strategy"] == "positional"
    assert result.stats["negatives_mined"] == 3
    assert result.stats["negatives_positional"] == 1
    assert result.stats["mined_candidates_excluded"] == 2


def test_choose_keeps_order_and_limit():
    candidates = [("x", 0.9), ("y", 0.8), ("x", 0.7), ("z", 0.6)]
    assert choose(candidates, lambda text: text == "y", 2) == [
        ("x", 0.9),
        ("z", 0.6),
    ]


class FakeReranker:
    model = "fake-reranker"

    def score(self, pairs):
        # Positive pairs score 0.9; a passage mentioning "Kamehameha" scores
        # above the positive (a likely false negative).
        return [
            0.95 if "Kamehameha" in passage else (0.9 if i == 0 else 0.2)
            for i, (_, passage) in enumerate(pairs)
        ]


def test_reranker_rows_have_scores_and_drop_false_negatives():
    chunks = doc_chunks()

    def fake_miner(pairs, corpus, config):
        return [[(text, 0.5) for text in corpus if text != pair[1]] for pair in pairs]

    result = build_triples(
        chunks,
        None,
        TriplesOptions(
            negatives="mined",
            near_dup="off",
            miner=fake_miner,
            reranker=FakeReranker(),
        ),
    )
    assert len(result.flag_rows) == len(result.train) == 4
    for flag in result.flag_rows:
        assert set(flag) >= {"query", "pos", "neg", "pos_scores", "neg_scores"}
        assert len(flag["neg"]) == len(flag["neg_scores"])
        assert all(score < flag["pos_scores"][0] for score in flag["neg_scores"])
        assert all("Kamehameha" not in text for text in flag["neg"])
    assert result.stats["reranker_false_negatives"] >= 1
    assert result.stats["reranker_model"] == "fake-reranker"


def cluster_chunks():
    """Twelve topics with disjoint vocabularies, each with a near-duplicate."""
    chunks = []
    for n in range(12):
        words = " ".join(f"w{n}x{k}" for k in range(30))
        chunks.append({"id": f"{n}-a", "doc_id": f"{n}-a", "text": words})
        chunks.append({"id": f"{n}-b", "doc_id": f"{n}-b", "text": words + " extra"})
    return chunks


def test_near_duplicate_clusters_stay_in_one_split():
    pytest.importorskip("datasketch")
    options = TriplesOptions(negatives="positional", near_dup="on", val_fraction=0.4)
    result = build_triples(cluster_chunks(), None, options)
    again = build_triples(cluster_chunks(), None, options)
    assert result.rows == again.rows
    assert result.stats["near_dup"] == "minhash"
    assert result.stats["near_dup_clusters"] == 12
    by_cluster = {}
    for row in result.rows:
        by_cluster.setdefault(row["cluster_id"], set()).add(row["split"])
    assert len(by_cluster) == 12
    assert all(len(splits) == 1 for splits in by_cluster.values())
    assert {"train", "val"} <= {row["split"] for row in result.rows}
    # Near-duplicates are never each other's negative.
    for row in result.rows:
        assert row["cluster_id"] != next(
            other["cluster_id"]
            for other in result.rows
            if other["positive"] == row["negative"]
        )
        assert {
            other["split"]
            for other in result.rows
            if other["positive"] == row["negative"]
        } == {row["split"]}

    dropped = build_triples(
        cluster_chunks(),
        None,
        TriplesOptions(negatives="positional", near_dup="on", near_dup_drop=True),
    )
    assert dropped.stats["near_dup_dropped"] == 12
    assert len(dropped.rows) == 12


def test_near_dup_auto_reports_missing_datasketch(monkeypatch):
    original_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "datasketch":
            raise ImportError("datasketch unavailable")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    result = build_triples(CHUNKS, None, TriplesOptions(negatives="positional"))
    assert result.stats["near_dup"].startswith("unavailable")


def test_cli_accepts_supervisor_flags_and_reports_gate_counts(tmp_path):
    chunks = tmp_path / "chunks.jsonl"
    chunks.write_text("".join(json.dumps(c) + "\n" for c in CHUNKS), encoding="utf-8")
    gold = tmp_path / "gold.jsonl"
    gold.write_text('{"q":"leak query sentence"}\n', encoding="utf-8")
    out_dir = tmp_path / "out"
    # The Rust runner passes --output-dir, --steps and optionally --base-model.
    result = CliRunner().invoke(
        main,
        [
            "--job-id",
            "triples-job",
            "--output-dir",
            str(out_dir),
            "--steps",
            "10",
            "--base-model",
            "local-model",
            "--input-chunks",
            str(chunks),
            "--output-triples",
            str(out_dir / "triples.jsonl"),
            "--gold-file",
            str(gold),
            "--negatives",
            "positional",
        ],
    )
    assert result.exit_code == 0, result.output
    emitted = events(result)
    assert [event["type"] for event in emitted] == ["start", "artifact", "done"]
    assert all(event["job_id"] == "triples-job" for event in emitted)
    assert emitted[1]["role"] == "triples"
    stats = emitted[2]["stats"]
    assert stats["gold_leaks"] == 1 and stats["train_rows"] == 2
    assert stats["negative_strategy"] == "positional"
    rows = [
        json.loads(line)
        for line in (out_dir / "triples.jsonl").read_text().splitlines()
    ]
    assert {"query", "positive", "negative", "chunk_id", "text_sha256"} <= set(rows[0])


def test_cli_writes_validation_split_as_separate_artifact(tmp_path):
    pytest.importorskip("datasketch")
    chunks = tmp_path / "chunks.jsonl"
    chunks.write_text(
        "".join(json.dumps(c) + "\n" for c in cluster_chunks()),
        encoding="utf-8",
    )
    result = CliRunner().invoke(
        main,
        [
            "--input-chunks",
            str(chunks),
            "--output-dir",
            str(tmp_path),
            "--negatives",
            "positional",
            "--near-dup",
            "on",
            "--val-fraction",
            "0.4",
        ],
    )
    assert result.exit_code == 0, result.output
    roles = [event["role"] for event in events(result) if event["type"] == "artifact"]
    assert roles == ["triples", "triples_val"]
    train = (tmp_path / "triples.jsonl").read_text().splitlines()
    val = (tmp_path / "triples.val.jsonl").read_text().splitlines()
    assert len(train) + len(val) == 24
    assert {json.loads(line)["split"] for line in val} == {"val"}
