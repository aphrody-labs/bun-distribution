# SPDX-License-Identifier: Apache-2.0
"""Conservative, redacted training datasets from Aphrody rollout JSONL."""

import hashlib
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any

import click

from .gates import GoldIndex
from .hashing import text_sha256
from .protocol import TrainEmitter

SECRET_KEYS = re.compile(
    r"(?:secret|password|passwd|token|credential|api[_-]?key|authorization|cookie|private[_-]?key)",
    re.IGNORECASE,
)
SECRET_PATTERNS = (
    re.compile(
        r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----",
        re.DOTALL,
    ),
    re.compile(r"\bBearer\s+\S+", re.IGNORECASE),
    re.compile(
        r"\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|AIza[A-Za-z0-9_-]{25,})\b"
    ),
    re.compile(
        r"\b(?:api[_-]?key|token|password|secret|authorization|cookie)\s*[:=]\s*[^\s,;]+",
        re.IGNORECASE,
    ),
    re.compile(r"https?://[^/@\s]+:[^/@\s]+@", re.IGNORECASE),
)


def redact(value):
    """Remove known credential fields and patterns before writing training data."""
    if isinstance(value, dict):
        return {
            key: "[REDACTED_SECRET]" if SECRET_KEYS.search(key) else redact(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, str):
        for pattern in SECRET_PATTERNS:
            value = pattern.sub("[REDACTED_SECRET]", value)
        return value
    return value


def _safe_parts(parts):
    result = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        for kind in ("text", "function_call", "function_response"):
            if kind in part:
                content = part[kind]
                if kind == "text" and isinstance(content, str):
                    result.append({kind: redact(content)})
                elif kind == "function_call" and isinstance(content, dict):
                    result.append(
                        {
                            kind: redact(
                                {
                                    key: content[key]
                                    for key in ("id", "name", "args")
                                    if key in content
                                }
                            )
                        }
                    )
                elif kind == "function_response" and isinstance(content, dict):
                    result.append(
                        {
                            kind: redact(
                                {
                                    key: content[key]
                                    for key in ("id", "name", "response")
                                    if key in content
                                }
                            )
                        }
                    )
                break
    return result


def read_rollout(path: Path) -> list[dict]:
    """Read the Rust rollout envelope, failing closed on malformed records."""
    lines = []
    with path.open(encoding="utf-8") as stream:
        for number, raw in enumerate(stream, 1):
            if not raw.strip():
                continue
            try:
                line = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise ValueError(f"malformed rollout at {path.name}:{number}") from exc
            if not isinstance(line, dict) or not isinstance(line.get("item"), dict):
                raise ValueError(f"invalid rollout envelope at {path.name}:{number}")
            lines.append(line["item"])
    return lines


def extract(path: Path) -> tuple[list[dict], list[dict]]:
    """Return proven successful turns and same-turn repaired tool preferences."""
    items = read_rollout(path)
    session_id = next(
        (
            item.get("payload", {}).get("id")
            for item in items
            if item.get("type") == "session_meta"
        ),
        None,
    )
    if not isinstance(session_id, str) or not session_id:
        raise ValueError(f"rollout has no session identity: {path.name}")
    session_hash = hashlib.sha256(session_id.encode()).hexdigest()[:16]
    turns = []
    preferences = []
    current: dict[str, Any] | None = None
    for item in items:
        if item.get("type") == "history_item":
            message = item.get("message")
            if not isinstance(message, dict):
                raise ValueError(f"invalid history item in {path.name}")
            role = message.get("role")
            parts = _safe_parts(message.get("parts", []))
            if item.get("compaction_checkpoint"):
                continue
            if role == "user":
                current = {
                    "messages": [{"role": role, "parts": parts}],
                    "failed": False,
                    "calls": {},
                    "ends": {},
                }
            elif current is not None and role in {"model", "tool"}:
                current["messages"].append({"role": role, "parts": parts})
                if role == "model":
                    for part in parts:
                        call = part.get("function_call")
                        if isinstance(call, dict) and isinstance(call.get("id"), str):
                            current["calls"][call["id"]] = call
            continue
        msg = item.get("msg")
        if not isinstance(msg, dict) or current is None:
            continue
        kind = msg.get("type")
        if kind == "error":
            current["failed"] = True
        elif kind == "tool_call_end":
            current["ends"][msg.get("call_id")] = msg.get("ok") is True
        elif kind == "turn_complete":
            messages = current["messages"]
            final_message = msg.get("last_agent_message")
            complete_calls = all(
                current["ends"].get(call_id) is True for call_id in current["calls"]
            ) and all(current["ends"].values())
            if (
                not current["failed"]
                and isinstance(final_message, str)
                and final_message.strip()
                and complete_calls
            ):
                prompt = next(
                    (part["text"] for part in messages[0]["parts"] if "text" in part),
                    "",
                )
                if prompt.strip():
                    turns.append(
                        {
                            "session": session_hash,
                            "prompt": prompt,
                            "messages": messages,
                        }
                    )
            # DPO only when a denied/refused call or failed patch was later repaired
            # by a successful call of the same tool in this exact turn.
            calls = list(current["calls"].values())
            for index, rejected in enumerate(calls):
                if current["ends"].get(rejected["id"]) is not False:
                    continue
                name = rejected.get("name")
                response: dict[str, Any] = next(
                    (
                        part.get("function_response", {}).get("response", {})
                        for message in messages
                        if message["role"] == "tool"
                        for part in message["parts"]
                        if part.get("function_response", {}).get("id") == rejected["id"]
                    ),
                    {},
                )
                detail = json.dumps(response, ensure_ascii=False).lower()
                if not (
                    "denied" in detail or "refused" in detail or name == "apply_patch"
                ):
                    continue
                chosen = next(
                    (
                        call
                        for call in calls[index + 1 :]
                        if call.get("name") == name
                        and current["ends"].get(call["id"]) is True
                        and call.get("args") != rejected.get("args")
                    ),
                    None,
                )
                prompt = next(
                    (part["text"] for part in messages[0]["parts"] if "text" in part),
                    "",
                )
                if (
                    chosen
                    and prompt.strip()
                    and not current["failed"]
                    and isinstance(final_message, str)
                    and final_message.strip()
                ):
                    preferences.append(
                        {
                            "session": session_hash,
                            "prompt": prompt,
                            "chosen": json.dumps(
                                chosen, sort_keys=True, ensure_ascii=False
                            ),
                            "rejected": json.dumps(
                                rejected, sort_keys=True, ensure_ascii=False
                            ),
                            "basis": "same_turn_repaired_tool_call",
                        }
                    )
            current = None
    return turns, preferences


def load_gold(path: Path) -> tuple[set[str], set[str]]:
    """Read gold queries and URLs strictly; malformed gold disables export."""
    queries: set[str] = set()
    urls: set[str] = set()
    with path.open(encoding="utf-8") as stream:
        for number, raw in enumerate(stream, 1):
            if not raw.strip():
                continue
            try:
                row = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise ValueError(f"invalid gold JSON at line {number}") from exc
            if not isinstance(row, dict):
                raise ValueError(f"invalid gold record at line {number}")
            for key, target in (
                ("query", queries),
                ("q", queries),
                ("expected_url", urls),
                ("expectUrl", urls),
                ("expectTitle", urls),
                ("expect", urls),
            ):
                value = row.get(key)
                if isinstance(value, str) and value.strip():
                    target.add(value.strip().lower())
                elif isinstance(value, list):
                    target.update(
                        item.strip().lower()
                        for item in value
                        if isinstance(item, str) and item.strip()
                    )
    if not queries and not urls:
        raise ValueError("gold file has no queries or expected URLs")
    return queries, urls


def leaks_gold(row: dict, queries: set[str], urls: set[str]) -> bool:
    """Return whether a row hashes to a gold query, sentence, title or URL.

    Compatibility wrapper over :class:`aphrody_train.gates.GoldIndex`; build
    the index once with ``GoldIndex.from_file`` when checking many rows.
    """
    return GoldIndex.from_values(queries, urls).match_row(row) is not None


def add_hashes(row: dict) -> dict:
    """Add ``text_sha256`` of the row prompt (additive fields only)."""
    prompt = row.get("prompt")
    if isinstance(prompt, str):
        row["text_sha256"] = text_sha256(prompt)
        row["text_casefold_sha256"] = text_sha256(prompt, casefold=True)
    return row


def write_jsonl_atomic(path: Path, rows: list[dict]) -> None:
    """Write rows as JSONL through an fsynced temporary file, then rename."""
    path.parent.mkdir(parents=True, exist_ok=True)
    staging = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=path.parent,
            prefix=".dataset-",
            suffix=".tmp",
            delete=False,
        ) as stream:
            staging = Path(stream.name)
            for row in rows:
                stream.write(json.dumps(row, ensure_ascii=False) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(staging, path)
    finally:
        if staging is not None:
            staging.unlink(missing_ok=True)


@click.group()
def main() -> None:
    """Build training datasets from verified Aphrody rollouts."""


@main.command("rollouts")
@click.option("--job-id", default="dataset-rollouts")
@click.option(
    "--rollout-dir",
    required=True,
    type=click.Path(exists=True, file_okay=False, path_type=Path),
)
@click.option("--output-dir", required=True, type=click.Path(path_type=Path))
@click.option(
    "--gold-file",
    required=True,
    type=click.Path(exists=True, dir_okay=False, path_type=Path),
)
@click.option("--steps", default=1, type=int, hidden=True)
@click.option(
    "--legacy-substring-guard/--no-legacy-substring-guard",
    default=False,
    help="Also apply the former substring gold heuristic",
)
def rollouts(
    job_id: str,
    rollout_dir: Path,
    output_dir: Path,
    gold_file: Path,
    steps: int,
    legacy_substring_guard: bool,
) -> None:
    """Export proven successful rollout turns as supervised examples."""
    _run(
        "rollouts",
        job_id,
        rollout_dir,
        output_dir,
        gold_file,
        legacy_substring_guard,
    )


@main.command("dpo")
@click.option("--job-id", default="dataset-dpo")
@click.option(
    "--rollout-dir",
    required=True,
    type=click.Path(exists=True, file_okay=False, path_type=Path),
)
@click.option("--output-dir", required=True, type=click.Path(path_type=Path))
@click.option(
    "--gold-file",
    required=True,
    type=click.Path(exists=True, dir_okay=False, path_type=Path),
)
@click.option("--steps", default=1, type=int, hidden=True)
@click.option(
    "--legacy-substring-guard/--no-legacy-substring-guard",
    default=False,
    help="Also apply the former substring gold heuristic",
)
def dpo(
    job_id: str,
    rollout_dir: Path,
    output_dir: Path,
    gold_file: Path,
    steps: int,
    legacy_substring_guard: bool,
) -> None:
    """Export same-turn repaired tool calls as DPO preference pairs."""
    _run(
        "dpo",
        job_id,
        rollout_dir,
        output_dir,
        gold_file,
        legacy_substring_guard,
    )


def _run(
    kind: str,
    job_id: str,
    rollout_dir: Path,
    output_dir: Path,
    gold_file: Path,
    legacy_substring_guard: bool = False,
) -> None:
    emitter = TrainEmitter(job_id)
    sources = sorted(
        path
        for path in rollout_dir.rglob("rollout-*.jsonl")
        if path.is_file() and not path.is_symlink()
    )
    emitter.start(f"dataset_{kind}", len(sources), {"source_count": len(sources)})
    try:
        gold = GoldIndex.from_file(gold_file, legacy_substring=legacy_substring_guard)
        if not sources:
            raise ValueError("no rollout JSONL files found")
        rows = []
        for source in sources:
            turns, preferences = extract(source)
            rows.extend(turns if kind == "rollouts" else preferences)
        stats: dict[str, Any] = {
            "rows_in": len(rows),
            "gold_rows": gold.rows,
            "gold_leaks": 0,
            "gold_leaks_text": 0,
            "gold_leaks_url": 0,
            "gold_leaks_substring": 0,
            "exact_duplicates": 0,
            "leak_gate": "sha256" + ("+substring" if legacy_substring_guard else ""),
        }
        kept = []
        seen = set()
        for row in rows:
            match = gold.match_row(row)
            if match:
                stats["gold_leaks"] += 1
                stats[f"gold_leaks_{match}"] += 1
                continue
            # Identical content from different sessions is one example.
            identity = text_sha256(
                json.dumps(
                    {key: value for key, value in row.items() if key != "session"},
                    sort_keys=True,
                    ensure_ascii=False,
                )
            )
            add_hashes(row)
            if identity in seen:
                stats["exact_duplicates"] += 1
                continue
            seen.add(identity)
            kept.append(row)
        rows = kept
        stats["rows_out"] = len(rows)
        if not rows:
            raise ValueError(f"no verified {kind} examples found")
        output = output_dir / f"{kind}.jsonl"
        write_jsonl_atomic(output, rows)
        data = output.read_bytes()
        emitter.artifact(kind, str(output), hashlib.sha256(data).hexdigest(), len(data))
        emitter.done(
            f"Exported {len(rows)} verified {kind} examples; filtered {stats['gold_leaks']} gold overlaps",
            stats=stats,
        )
    except Exception as exc:
        emitter.error(str(exc))
        raise click.ClickException(str(exc)) from exc


if __name__ == "__main__":
    main()
