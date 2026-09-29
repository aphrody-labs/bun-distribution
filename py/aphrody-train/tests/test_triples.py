# SPDX-License-Identifier: Apache-2.0
import json
import tempfile

from aphrody_train.triples import generate_triples, is_gold_leak


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


def test_generate_triples_filters_leaks():
    with tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8") as f:
        f.write(
            json.dumps(
                {"query": "leak query", "expected_url": "http://leak.com"}
            )
            + "\n"
        )
        gold_path = f.name

    chunks = [
        {
            "id": "1",
            "text": "This is a clean and regular chunk of text for testing.",
        },
        {
            "id": "2",
            "text": "leak query should be filtered by the gold leak guard.",
        },
        {
            "id": "3",
            "text": "Another clean chunk that should produce valid triples.",
        },
    ]

    triples, leaks = generate_triples(chunks, gold_path)
    assert leaks >= 1
    for t in triples:
        assert "leak query" not in t["query"]
