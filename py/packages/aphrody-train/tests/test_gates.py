# SPDX-License-Identifier: Apache-2.0
import pytest

from aphrody_train.dataset import leaks_gold
from aphrody_train.gates import (
    GoldIndex,
    assign_split,
    near_duplicate_clusters,
)


def write_gold(tmp_path, *lines):
    path = tmp_path / "gold.jsonl"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def test_anti_join_matches_exact_hashes_not_substrings(tmp_path):
    gold = GoldIndex.from_file(
        write_gold(
            tmp_path,
            '{"q":"How does the GPU lease work?","expectUrl":["https://example.com/gpu"]}',
            '{"q":"Who is Goku","expectTitle":"Son Goku"}',
        )
    )
    assert gold.rows == 2
    # Exact, case and whitespace variants of a gold query.
    assert gold.match(["how  does the gpu LEASE work?"]) == "text"
    # A gold query embedded as one sentence of a passage.
    assert gold.match(["Intro text here. How does the GPU lease work? End."]) == "text"
    # Gold URLs by URL field or inside the text; fragments and slashes ignored.
    assert gold.match(["unrelated"], ["https://EXAMPLE.com/gpu/#x"]) == "url"
    assert gold.match(["see https://example.com/gpu for details"]) == "url"
    # A title equal to a gold expected title.
    assert gold.match(["Son Goku"]) == "text"
    # Substring-only overlaps no longer count.
    assert gold.match(["How does the GPU lease work in detail on Linux"]) is None
    assert gold.match(["see https://example.com/gpu/details"]) is None


def test_legacy_substring_guard_is_opt_in(tmp_path):
    path = write_gold(tmp_path, '{"q":"leak query here"}')
    text = ["this sentence mentions leak query here in passing and more"]
    assert GoldIndex.from_file(path).match(text) is None
    assert GoldIndex.from_file(path, legacy_substring=True).match(text) == "substring"


def test_gold_file_is_strict(tmp_path):
    with pytest.raises(ValueError, match="invalid gold JSON"):
        GoldIndex.from_file(write_gold(tmp_path, "{not json"))
    with pytest.raises(ValueError, match="no queries"):
        GoldIndex.from_file(write_gold(tmp_path, '{"other":"x"}'))
    with pytest.raises(ValueError, match="does not exist"):
        GoldIndex.from_file(tmp_path / "missing.jsonl")


def test_dataset_compat_wrapper_uses_hash_gate():
    row = {"prompt": "Reserved evaluation prompt", "messages": []}
    assert leaks_gold(row, {"reserved evaluation prompt"}, set())
    assert not leaks_gold(row, {"evaluation"}, set())


CRANE = (
    "The crane school chapter describes how the training arc begins on the "
    "lookout with a long climb, a test of patience and a final duel against "
    "an old master who refuses to teach anyone without discipline"
)
TURTLE = (
    "Turtle hermit students carry heavy shells while delivering milk across "
    "the island every morning, then plough fields with bare hands before "
    "swimming with sharks in the afternoon until sunset arrives"
)


def test_minhash_groups_near_duplicates_deterministically():
    pytest.importorskip("datasketch")
    texts = [
        CRANE,
        TURTLE,
        CRANE + " today.",
        "A completely different passage about cooking rice in a clay pot.",
        TURTLE.upper() + " again",
    ]
    roots = near_duplicate_clusters(texts)
    assert roots == near_duplicate_clusters(texts)
    assert roots[0] == roots[2] == 0
    assert roots[1] == roots[4] == 1
    assert roots[3] == 3
    # A stricter threshold only splits clusters, it never merges new ones.
    strict = near_duplicate_clusters(texts, threshold=0.97)
    assert all(roots[i] == roots[s] for i, s in enumerate(strict))
    with pytest.raises(ValueError, match="cannot band"):
        near_duplicate_clusters(texts, threshold=0.99)


def test_split_assignment_is_per_cluster_and_stable():
    keys = [f"cluster-{n}" for n in range(200)]
    splits = [assign_split(key, 0.25, "seed") for key in keys]
    assert splits == [assign_split(key, 0.25, "seed") for key in keys]
    assert 20 < splits.count("val") < 80
    assert all(assign_split(key, 0.0, "seed") == "train" for key in keys)
    assert splits != [assign_split(key, 0.25, "other-seed") for key in keys]


def test_dataset_rows_gain_hashes_and_cross_session_duplicates_drop(tmp_path):
    import json

    from click.testing import CliRunner

    from aphrody_train.dataset import main as dataset_main
    from aphrody_train.hashing import text_sha256

    rollout_dir = tmp_path / "rollouts"
    rollout_dir.mkdir()
    for session in ("one", "two"):
        items = [
            {"type": "session_meta", "payload": {"id": session}},
            {
                "type": "history_item",
                "message": {"role": "user", "parts": [{"text": "Explain it"}]},
            },
            {
                "type": "history_item",
                "message": {"role": "model", "parts": [{"text": "It works."}]},
            },
            {
                "id": "e",
                "msg": {
                    "type": "turn_complete",
                    "last_agent_message": "It works.",
                },
            },
        ]
        (rollout_dir / f"rollout-{session}.jsonl").write_text(
            "".join(json.dumps({"item": item}) + "\n" for item in items),
            encoding="utf-8",
        )
    gold = write_gold(tmp_path, '{"q":"unrelated gold question"}')
    output = tmp_path / "out"
    result = CliRunner().invoke(
        dataset_main,
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
    rows = (output / "rollouts.jsonl").read_text().splitlines()
    assert len(rows) == 1
    assert json.loads(rows[0])["text_sha256"] == text_sha256("Explain it")
    done = json.loads(result.output.splitlines()[-1])
    assert done["stats"]["exact_duplicates"] == 1
    assert done["stats"]["gold_leaks"] == 0
