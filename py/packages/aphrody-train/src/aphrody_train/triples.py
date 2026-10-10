# SPDX-License-Identifier: Apache-2.0
"""Training triples with hash leak gates, near-duplicate splits and mined negatives.

Pipeline, in order:

1. Chunks shorter than 30 characters are skipped; the query is the first
   sentence of the chunk.
2. Exact duplicates (casefolded canonical SHA-256 of the passage) are dropped.
3. Gold anti-join: rows whose query, passage, sentences, title or URLs hash to
   a gold key are dropped (see :mod:`aphrody_train.gates`).
4. Optional MinHash near-duplicate clustering, before split assignment; a whole
   cluster is assigned to one split.
5. Negatives are mined per split with sentence-transformers, excluding the
   same document and the same cluster, or chosen positionally
   (``(idx + n/2) % n``) when asked or when mining is unavailable.
"""

import hashlib
import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

import click

from .gates import (
    DEFAULT_MINHASH_SEED,
    DEFAULT_NEAR_DUP_THRESHOLD,
    DEFAULT_NUM_PERM,
    DEFAULT_SHINGLE_SIZE,
    GoldIndex,
    NearDupUnavailableError,
    assign_split,
    near_duplicate_clusters,
)
from .hashing import normalize_url, text_sha256
from .negatives import (
    DEFAULT_MINER_MODEL,
    Miner,
    MiningConfig,
    MiningUnavailableError,
    RerankerScorer,
    choose,
    mine_candidates,
    positional,
)
from .protocol import TrainEmitter

MIN_CHUNK_CHARS = 30
DOCUMENT_KEYS = ("doc_id", "document_id", "source_id", "parent_id", "doc")
DOCUMENT_URL_KEYS = ("url", "source_url")
DOCUMENT_PATH_KEYS = ("path", "source_path", "file")
TITLE_KEYS = ("title", "heading")


def load_gold_queries_and_urls(gold_path: str) -> tuple[set[str], set[str]]:
    """Load query strings and expected URLs from the gold evaluation set.

    Kept for callers of the former substring guard; the triples command uses
    :class:`aphrody_train.gates.GoldIndex`.
    """
    queries: set[str] = set()
    urls: set[str] = set()
    if not os.path.isfile(gold_path):
        raise ValueError(f"gold evaluation file does not exist: {gold_path}")

    with open(gold_path, encoding="utf-8") as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
                for key, target in (
                    ("query", queries),
                    ("q", queries),
                    ("expected_url", urls),
                    ("expectUrl", urls),
                    ("expectTitle", urls),
                    ("expect", urls),
                ):
                    value = item.get(key)
                    if isinstance(value, str) and value.strip():
                        target.add(value.strip().lower())
                    elif isinstance(value, list):
                        target.update(
                            val.strip().lower()
                            for val in value
                            if isinstance(val, str) and val.strip()
                        )
            except (ValueError, TypeError, AttributeError) as exc:
                raise ValueError(f"Invalid gold record: {exc}") from exc
    return queries, urls


def is_gold_leak(
    query: str, positive: str, gold_queries: set[str], gold_urls: set[str]
) -> bool:
    """Former substring heuristic, kept for ``--legacy-substring-guard`` callers."""
    q_lower = query.strip().lower()
    for gq in gold_queries:
        if gq and (q_lower == gq or (len(gq) >= 10 and gq in q_lower)):
            return True

    pos_lower = positive.strip().lower()
    for gq in gold_queries:
        if len(gq) > 8 and gq in pos_lower:
            return True

    return any(u and u in pos_lower for u in gold_urls)


@dataclass
class TriplesOptions:
    """Gate, split and negative-selection options of :func:`build_triples`."""

    negatives: str = "auto"
    mining: MiningConfig = field(default_factory=MiningConfig)
    near_dup: str = "auto"
    near_dup_threshold: float = DEFAULT_NEAR_DUP_THRESHOLD
    num_perm: int = DEFAULT_NUM_PERM
    shingle_size: int = DEFAULT_SHINGLE_SIZE
    minhash_seed: int = DEFAULT_MINHASH_SEED
    near_dup_drop: bool = False
    val_fraction: float = 0.0
    split_seed: str = "aphrody-train"
    legacy_substring_guard: bool = False
    reranker_model: str | None = None
    miner: Miner | None = None
    reranker: object | None = None

    def validate(self) -> None:
        """Reject inconsistent options before any work starts."""
        if self.negatives not in {"auto", "mined", "positional"}:
            raise ValueError("negatives must be auto, mined or positional")
        if self.near_dup not in {"auto", "on", "off"}:
            raise ValueError("near-dup must be auto, on or off")
        if not 0.0 <= self.val_fraction < 1.0:
            raise ValueError("validation fraction must be in [0, 1)")


@dataclass
class TriplesResult:
    """Rows of both splits, reranker rows and gate counts."""

    rows: list[dict]
    flag_rows: list[dict]
    stats: dict

    @property
    def train(self) -> list[dict]:
        """Rows assigned to the training split."""
        return [row for row in self.rows if row["split"] == "train"]

    @property
    def val(self) -> list[dict]:
        """Rows assigned to the validation split."""
        return [row for row in self.rows if row["split"] == "val"]


@dataclass
class _Row:
    index: int
    chunk: dict
    query: str
    positive: str
    positive_key: str
    document: str
    cluster: str = ""
    split: str = "train"


def make_query(text: str) -> str:
    """Synthetic query: the first sentence, or a prefixed excerpt when short."""
    sentences = re.split(r"[.!?\n]", text)
    query = sentences[0].strip() if sentences else text[:60].strip()
    if len(query) < 10:
        query = f"Search for: {text[:40].strip()}"
    return query


def document_key(chunk: dict, index: int) -> str:
    """Identity of the source document, used to exclude same-document negatives."""
    for key in DOCUMENT_KEYS:
        value = chunk.get(key)
        if isinstance(value, str | int) and str(value).strip():
            return f"doc:{value}"
    for key in DOCUMENT_URL_KEYS:
        value = chunk.get(key)
        if isinstance(value, str) and value.strip():
            return "url:" + normalize_url(value)
    for key in DOCUMENT_PATH_KEYS:
        value = chunk.get(key)
        if isinstance(value, str) and value.strip():
            return f"path:{value.strip()}"
    return f"chunk:{chunk.get('id', index)}"


def _chunk_strings(chunk: dict, keys: tuple[str, ...]) -> list[str]:
    return [
        chunk[key]
        for key in keys
        if isinstance(chunk.get(key), str) and chunk[key].strip()
    ]


def build_triples(
    chunks: list[dict],
    gold: GoldIndex | None = None,
    options: TriplesOptions | None = None,
    emitter: TrainEmitter | None = None,
) -> TriplesResult:
    """Run the gates and negative selection described in the module docstring."""
    options = options or TriplesOptions()
    options.validate()
    if len(chunks) < 2:
        raise ValueError(
            "at least two source chunks are required for distinct negatives"
        )
    stats: dict = {
        "chunks_in": len(chunks),
        "chunks_short": 0,
        "exact_duplicates": 0,
        "gold_rows": gold.rows if gold else 0,
        "gold_leaks": 0,
        "gold_leaks_text": 0,
        "gold_leaks_url": 0,
        "gold_leaks_substring": 0,
    }

    rows: list[_Row] = []
    seen: set[str] = set()
    total = len(chunks)
    for idx, chunk in enumerate(chunks):
        if emitter and (idx + 1) % 10 == 0:
            emitter.progress(step=idx + 1, total_steps=total, loss=0.0)
        text = chunk.get("text", "")
        if not isinstance(text, str) or len(text.strip()) < MIN_CHUNK_CHARS:
            stats["chunks_short"] += 1
            continue
        key = text_sha256(text, casefold=True)
        if key in seen:
            stats["exact_duplicates"] += 1
            continue
        seen.add(key)
        query = make_query(text)
        if gold is not None:
            kind = gold.match(
                [query, text, *_chunk_strings(chunk, TITLE_KEYS)],
                _chunk_strings(chunk, DOCUMENT_URL_KEYS),
            )
            if kind:
                stats["gold_leaks"] += 1
                stats[f"gold_leaks_{kind}"] += 1
                continue
        rows.append(_Row(idx, chunk, query, text, key, document_key(chunk, idx)))

    _cluster(rows, options, stats)
    if options.near_dup_drop:
        kept = []
        representatives = set()
        for row in rows:
            if row.cluster in representatives:
                stats["near_dup_dropped"] += 1
                continue
            representatives.add(row.cluster)
            kept.append(row)
        rows = kept
    for row in rows:
        row.split = assign_split(row.cluster, options.val_fraction, options.split_seed)

    scorer = options.reranker
    if scorer is None and options.reranker_model:
        scorer = RerankerScorer(options.reranker_model, device=options.mining.device)
    stats.update(
        {
            "negative_strategy": "positional"
            if options.negatives == "positional"
            else "mined",
            "negative_fallback_reason": "",
            "negatives_mined": 0,
            "negatives_positional": 0,
            "mined_candidates_excluded": 0,
            "reranker_model": getattr(scorer, "model", "") if scorer else "",
            "reranker_false_negatives": 0,
            "rows_without_negative": 0,
        }
    )
    output: list[dict] = []
    flag_rows: list[dict] = []
    for split in ("train", "val"):
        group = [row for row in rows if row.split == split]
        if not group:
            continue
        triples, flags = _negatives(group, options, scorer, stats)
        output.extend(triples)
        if split == "train":
            flag_rows.extend(flags)
    stats["train_rows"] = sum(1 for row in output if row["split"] == "train")
    stats["val_rows"] = sum(1 for row in output if row["split"] == "val")
    if not output:
        raise ValueError("no triples remain after validation and gold-leak filtering")
    output.sort(key=lambda row: row["_index"])
    for output_row in output:
        del output_row["_index"]
    return TriplesResult(output, flag_rows, stats)


def _cluster(rows: list[_Row], options: TriplesOptions, stats: dict) -> None:
    stats.update(
        {
            "near_dup": "off",
            "near_dup_threshold": options.near_dup_threshold,
            "near_dup_clusters": 0,
            "near_dup_duplicates": 0,
            "near_dup_dropped": 0,
        }
    )
    for row in rows:
        row.cluster = text_sha256(row.positive)
    if options.near_dup == "off" or len(rows) < 2:
        return
    try:
        roots = near_duplicate_clusters(
            [row.positive for row in rows],
            threshold=options.near_dup_threshold,
            num_perm=options.num_perm,
            shingle_size=options.shingle_size,
            seed=options.minhash_seed,
        )
    except NearDupUnavailableError as exc:
        if options.near_dup == "on":
            raise
        stats["near_dup"] = f"unavailable: {exc}"
        return
    stats["near_dup"] = "minhash"
    sizes: dict[int, int] = {}
    for root in roots:
        sizes[root] = sizes.get(root, 0) + 1
    stats["near_dup_clusters"] = sum(1 for size in sizes.values() if size > 1)
    stats["near_dup_duplicates"] = sum(size - 1 for size in sizes.values() if size > 1)
    for row, root in zip(rows, roots, strict=True):
        row.cluster = rows[root].cluster


def _negatives(
    group: list[_Row],
    options: TriplesOptions,
    scorer,
    stats: dict,
) -> tuple[list[dict], list[dict]]:
    by_text = {row.positive: row for row in group}

    def related(row: _Row, other: _Row) -> bool:
        return (
            other is row
            or other.document == row.document
            or other.cluster == row.cluster
            or other.positive_key == row.positive_key
        )

    # A fallback decided on the train split also applies to the val split.
    mined: list[list[tuple[str, float]]] | None = None
    if options.negatives != "positional" and not stats["negative_fallback_reason"]:
        miner = options.miner or mine_candidates
        try:
            mined = miner(
                [(row.query, row.positive) for row in group],
                [row.positive for row in group],
                options.mining,
            )
        except MiningUnavailableError as exc:
            if options.negatives == "mined":
                raise
            stats["negative_strategy"] = "positional"
            stats["negative_fallback_reason"] = str(exc)
        if mined is not None and len(mined) != len(group):
            raise RuntimeError("miner returned a candidate list per row mismatch")

    fallback = positional(len(group), lambda i, j: related(group[i], group[j]))
    triples: list[dict] = []
    flags: list[dict] = []
    for position, row in enumerate(group):
        candidates: list[tuple[str, float | None]] = []
        strategy = "positional"
        if mined is not None:

            def excluded(text: str, row: _Row = row) -> bool:
                other = by_text.get(text)
                if other is None or related(row, other):
                    stats["mined_candidates_excluded"] += 1
                    return True
                return False

            candidates = [
                (candidate, score)
                for candidate, score in choose(
                    mined[position], excluded, options.mining.pool
                )
            ]
            strategy = "mined"
        pos_score = None
        neg_scores: list[float] = []
        if scorer is not None and candidates:
            pos_score, *neg_scores = scorer.score(
                [(row.query, row.positive)]
                + [(row.query, text) for text, _ in candidates]
            )
            kept = [
                (candidate, score)
                for candidate, score in zip(candidates, neg_scores, strict=True)
                if score < pos_score
            ]
            stats["reranker_false_negatives"] += len(candidates) - len(kept)
            candidates = [candidate for candidate, _ in kept]
            neg_scores = [score for _, score in kept]
        if not candidates:
            choice = fallback[position]
            if choice is None:
                stats["rows_without_negative"] += 1
                continue
            candidates = [(group[choice].positive, None)]
            strategy = "positional"
            if scorer is not None:
                pos_score, neg_score = scorer.score(
                    [(row.query, row.positive), (row.query, candidates[0][0])]
                )
                neg_scores = [neg_score]
        stats[f"negatives_{strategy}"] += 1
        negative, negative_score = candidates[0]
        triple = {
            "query": row.query,
            "positive": row.positive,
            "negative": negative,
            "chunk_id": row.chunk.get("id", f"c_{row.index}"),
            "text_sha256": text_sha256(row.query),
            "text_casefold_sha256": text_sha256(row.query, casefold=True),
            "positive_sha256": text_sha256(row.positive),
            "negative_sha256": text_sha256(negative),
            "cluster_id": row.cluster,
            "split": row.split,
            "negative_strategy": strategy,
            "_index": row.index,
        }
        if negative_score is not None:
            triple["negative_score"] = negative_score
        triples.append(triple)
        if scorer is not None:
            flags.append(
                {
                    "query": row.query,
                    "pos": [row.positive],
                    "neg": [text for text, _ in candidates],
                    "pos_scores": [pos_score],
                    "neg_scores": neg_scores,
                    "text_sha256": triple["text_sha256"],
                }
            )
    return triples, flags


def generate_triples(
    chunks: list[dict],
    gold_path: str = "",
    emitter: TrainEmitter | None = None,
    options: TriplesOptions | None = None,
) -> tuple[list[dict], int]:
    """Generate triples of every split and return them with the gold-leak count."""
    gold = (
        GoldIndex.from_file(
            gold_path,
            legacy_substring=bool(options and options.legacy_substring_guard),
        )
        if gold_path
        else None
    )
    result = build_triples(chunks, gold, options, emitter)
    return result.rows, result.stats["gold_leaks"]


def read_chunks(input_chunks: str) -> list[dict]:
    """Read chunk JSONL; ``text``, ``markdown`` or ``content`` carries the text."""
    if not os.path.isfile(input_chunks):
        raise ValueError(f"source chunks file does not exist: {input_chunks}")
    chunks = []
    with open(input_chunks, encoding="utf-8") as f:
        for line_number, line in enumerate(f, 1):
            if not line.strip():
                continue
            try:
                chunk = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(
                    f"invalid JSON at {input_chunks}:{line_number}: {exc}"
                ) from exc
            if not isinstance(chunk, dict):
                raise ValueError(f"{input_chunks}:{line_number} requires a dictionary")
            text_val = (
                chunk.get("text") or chunk.get("markdown") or chunk.get("content")
            )
            if not isinstance(text_val, str):
                raise ValueError(f"{input_chunks}:{line_number} requires a text string")
            chunk_norm = dict(chunk)
            chunk_norm["text"] = text_val
            chunks.append(chunk_norm)
    return chunks


def write_jsonl(path: Path, rows: list[dict]) -> tuple[str, int]:
    """Write rows as JSONL and return the file SHA-256 and size."""
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = "".join(json.dumps(row) + "\n" for row in rows).encode("utf-8")
    path.write_bytes(payload)
    return hashlib.sha256(payload).hexdigest(), len(payload)


def sibling(path: Path, suffix: str) -> Path:
    """``triples.jsonl`` -> ``triples.<suffix>.jsonl``."""
    return path.with_name(f"{path.stem}.{suffix}{path.suffix or '.jsonl'}")


@click.command()
@click.option("--job-id", default="job-triples", help="Job identifier")
@click.option("--input-chunks", required=True, help="Input chunks JSONL path")
@click.option(
    "--output-triples",
    default="",
    help="Output triples JSONL path (default: <output-dir>/triples.jsonl)",
)
@click.option(
    "--gold-file", default="", help="Path to gold eval JSONL for leakage check"
)
@click.option(
    "--output-dir",
    default="",
    help="Job output directory (passed by the Rust supervisor)",
)
@click.option("--steps", default=1, type=int, hidden=True)
@click.option(
    "--base-model",
    default="",
    help="Embedding model being trained; the default miner model",
)
@click.option(
    "--negatives",
    type=click.Choice(["auto", "mined", "positional"]),
    default="auto",
    show_default=True,
    help="auto mines when sentence-transformers and the model load, "
    "else falls back to positional",
)
@click.option("--miner-model", default="", help="Bi-encoder used for mining")
@click.option("--mine-range-min", default=0, type=int, show_default=True)
@click.option("--mine-range-max", default=50, type=int, show_default=True)
@click.option("--mine-max-score", default=0.8, type=float, show_default=True)
@click.option("--mine-relative-margin", default=0.05, type=float, show_default=True)
@click.option(
    "--mine-sampling",
    type=click.Choice(["top", "random"]),
    default="top",
    show_default=True,
)
@click.option(
    "--mine-pool",
    default=8,
    type=int,
    show_default=True,
    help="Candidates per query before same-document filtering",
)
@click.option("--mine-batch-size", default=32, type=int, show_default=True)
@click.option("--device", default="", help="Torch device for mining/reranking")
@click.option(
    "--reranker-model",
    default="",
    help="Cross-encoder; writes FlagEmbedding JSONL with pos/neg scores",
)
@click.option(
    "--near-dup",
    type=click.Choice(["auto", "on", "off"]),
    default="auto",
    show_default=True,
    help="MinHash clustering; auto skips it when datasketch is missing",
)
@click.option(
    "--near-dup-threshold",
    default=DEFAULT_NEAR_DUP_THRESHOLD,
    type=float,
    show_default=True,
)
@click.option("--minhash-perm", default=DEFAULT_NUM_PERM, type=int, show_default=True)
@click.option(
    "--shingle-size", default=DEFAULT_SHINGLE_SIZE, type=int, show_default=True
)
@click.option(
    "--near-dup-drop/--near-dup-keep",
    default=False,
    show_default=True,
    help="Keep only the first member of each near-duplicate cluster",
)
@click.option(
    "--val-fraction",
    default=0.0,
    type=float,
    show_default=True,
    help="Clusters assigned to <output>.val.jsonl",
)
@click.option("--split-seed", default="aphrody-train", show_default=True)
@click.option(
    "--legacy-substring-guard/--no-legacy-substring-guard",
    default=False,
    show_default=True,
    help="Also apply the former substring gold heuristic",
)
def main(
    job_id: str,
    input_chunks: str,
    output_triples: str,
    gold_file: str,
    output_dir: str,
    steps: int,
    base_model: str,
    negatives: str,
    miner_model: str,
    mine_range_min: int,
    mine_range_max: int,
    mine_max_score: float,
    mine_relative_margin: float,
    mine_sampling: str,
    mine_pool: int,
    mine_batch_size: int,
    device: str,
    reranker_model: str,
    near_dup: str,
    near_dup_threshold: float,
    minhash_perm: int,
    shingle_size: int,
    near_dup_drop: bool,
    val_fraction: float,
    split_seed: str,
    legacy_substring_guard: bool,
):
    """Generate training triples from chunks, discarding gold-set leaks."""
    mining = MiningConfig(
        model=miner_model or base_model or DEFAULT_MINER_MODEL,
        range_min=mine_range_min,
        range_max=mine_range_max,
        max_score=mine_max_score,
        relative_margin=mine_relative_margin,
        sampling_strategy=mine_sampling,
        pool=mine_pool,
        batch_size=mine_batch_size,
        device=device or None,
    )
    options = TriplesOptions(
        negatives=negatives,
        mining=mining,
        near_dup=near_dup,
        near_dup_threshold=near_dup_threshold,
        num_perm=minhash_perm,
        shingle_size=shingle_size,
        near_dup_drop=near_dup_drop,
        val_fraction=val_fraction,
        split_seed=split_seed,
        legacy_substring_guard=legacy_substring_guard,
        reranker_model=reranker_model or None,
    )
    emitter = TrainEmitter(job_id)
    emitter.start(
        "dataset_triples",
        total_steps=0,
        metadata={
            "gold_file": gold_file,
            "negatives": negatives,
            "near_dup": near_dup,
            "near_dup_threshold": near_dup_threshold,
            "val_fraction": val_fraction,
            "leak_gate": "sha256" + ("+substring" if legacy_substring_guard else ""),
            **({} if negatives == "positional" else mining.as_metadata()),
        },
    )
    try:
        options.validate()
        if not output_triples and not output_dir:
            raise ValueError("--output-triples or --output-dir is required")
        output = Path(output_triples or os.path.join(output_dir, "triples.jsonl"))
        chunks = read_chunks(input_chunks)
        gold = (
            GoldIndex.from_file(gold_file, legacy_substring=legacy_substring_guard)
            if gold_file
            else None
        )
        result = build_triples(chunks, gold, options, emitter)
        train = result.train
        if not train:
            raise ValueError("no training triples remain after split assignment")
        artifacts = [("triples", output, train)]
        if result.val:
            artifacts.append(("triples_val", sibling(output, "val"), result.val))
        if result.flag_rows:
            artifacts.append(
                ("reranker_flag", sibling(output, "flag"), result.flag_rows)
            )
        written = [
            (role, path, *write_jsonl(path, rows)) for role, path, rows in artifacts
        ]
    except Exception as exc:
        emitter.error(str(exc))
        raise click.ClickException(str(exc)) from exc

    for role, path, sha, size in written:
        emitter.artifact(role, str(path), sha, size)
    stats = result.stats
    emitter.done(
        summary=(
            f"Generated {len(train)} triples ({stats['val_rows']} validation); "
            f"filtered {stats['gold_leaks']} gold-leaks; "
            f"negatives: {stats['negative_strategy']}."
        ),
        stats=stats,
    )


if __name__ == "__main__":
    main()
