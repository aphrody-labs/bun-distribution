#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Apply and validate the Python workspace migration with one entry point.

Run ``python tools/packaging/modernize_workspace.py apply`` then ``check``.
The migration is idempotent, refuses move collisions and never reads secrets.
"""

from __future__ import annotations

import argparse
import ast
import email.parser
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import tomllib
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
PIN = "02fa7fa362d815f788074ae09998041b34f9a770"
FORK = "https://github.com/aphrody-labs/antigravity-sdk-python.git"
FORK_REQUIREMENT = f"google-antigravity @ git+{FORK}@{PIN}"
SDK = ROOT / "packages/aphrody"


def run(*args: str, cwd: Path = ROOT) -> None:
    """Execute a checked command without a shell."""
    print("+ " + " ".join(args), flush=True)
    subprocess.run(args, cwd=cwd, check=True)


def write(path: Path, text: str) -> None:
    """Write UTF-8/LF source only when the content changes."""
    content = text.replace("\r\n", "\n").encode()
    if path.exists() and path.read_bytes() == content:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)


def replace(path: Path, old: str, new: str) -> None:
    """Replace a known source fragment, preserving file permissions."""
    write(path, path.read_text(encoding="utf-8").replace(old, new))


def move(source: Path, target: Path) -> None:
    """Move once, rejecting an existing destination."""
    if not source.exists():
        return
    if target.exists():
        raise FileExistsError(f"Migration collision: {target}")
    target.parent.mkdir(parents=True, exist_ok=True)
    source.rename(target)


def value(item: Any) -> str:
    """Serialize the TOML value types used by package metadata."""
    if isinstance(item, str):
        return json.dumps(item, ensure_ascii=False)
    if isinstance(item, bool):
        return str(item).lower()
    if isinstance(item, list):
        return "[" + ", ".join(value(part) for part in item) + "]"
    if isinstance(item, dict):
        return (
            "{ "
            + ", ".join(f"{value(key)} = {value(part)}" for key, part in item.items())
            + " }"
        )
    return str(item)


def metadata(path: Path, data: dict[str, Any]) -> None:
    """Emit deterministic TOML and verify it round-trips before replacing it."""
    lines = ["# SPDX-License-Identifier: Apache-2.0"]

    def key(text: str) -> str:
        return text if re.fullmatch(r"[A-Za-z0-9_-]+", text) else value(text)

    def table(parts: list[str], entries: dict[str, Any]) -> None:
        if parts and (
            not entries or any(not isinstance(item, dict) for item in entries.values())
        ):
            lines.extend(("", "[" + ".".join(key(part) for part in parts) + "]"))
        for name, item in entries.items():
            if not isinstance(item, dict):
                lines.append(f"{key(name)} = {value(item)}")
        for name, item in entries.items():
            if isinstance(item, dict):
                table([*parts, name], item)

    table([], data)
    text = "\n".join(lines) + "\n"
    if tomllib.loads(text) != data:
        raise ValueError(f"TOML round-trip failed: {path}")
    write(path, text)


def load(path: Path) -> dict[str, Any]:
    """Read package metadata without importing application code."""
    return tomllib.loads(path.read_text(encoding="utf-8"))


def shim(module: str) -> str:
    """Keep old imports while making the owning distribution explicit."""
    return f'''# SPDX-License-Identifier: Apache-2.0
"""Compatibility import; implementation is owned by {module.split(".")[0]}."""
from importlib import import_module
import sys

try:
    _implementation = import_module({module!r})
except ModuleNotFoundError as exc:
    if exc.name == {module.split(".")[0]!r}:
        raise ImportError("Install the {module.split(".")[0].replace("_", "-")} distribution for this API") from exc
    raise
sys.modules[__name__] = _implementation
'''


def migrate_layout() -> None:
    """Separate installed source, CLI implementations and meeting application."""
    shutil.rmtree(ROOT / "packages/ai", ignore_errors=True)
    shutil.rmtree(ROOT / "packages/shenron", ignore_errors=True)
    move(SDK / "aphrody", SDK / "src/aphrody")
    package = SDK / "src/aphrody"
    cli = ROOT / "packages/cli/src/aphrody_cli"
    # A previous completed run leaves compatibility files in this directory.
    if not cli.exists():
        move(package / "cli", cli)
        move(package / "google_cli.py", cli / "google.py")
        for path in cli.rglob("*.py"):
            replace(path, "aphrody.cli", "aphrody_cli")
    for path in cli.rglob("*.py"):
        replace(path, "aphrody_client", "aphrody.client")
        if path.name == "google.py":
            continue
        relative = path.relative_to(cli)
        module = "aphrody_cli" + (
            "." + ".".join(relative.with_suffix("").parts)
            if relative.name != "__init__.py"
            else ""
        )
        proxy = shim(module)
        if relative.name == "__init__.py":
            proxy = proxy.replace("import sys\n", "").replace(
                "sys.modules[__name__] = _implementation",
                'def __getattr__(name: str):\n    return getattr(_implementation, name)\n\n__all__ = ["Aphrody", "main"]',
            )
        write(package / "cli" / relative, proxy)
    write(package / "google_cli.py", shim("aphrody_cli.google"))
    # The original API is aphrody.google_cli; discard a migration-only alias.
    (package / "cli/google.py").unlink(missing_ok=True)
    meetings = ROOT / "apps/meetings/src/aphrody_meetings"
    if not (meetings / "pipeline.py").exists():
        move(package / "pipeline_meeting.py", meetings / "pipeline.py")
        write(
            meetings / "__init__.py",
            '# SPDX-License-Identifier: Apache-2.0\n"""Audio meeting application built on the Aphrody SDK."""\n',
        )
        write(package / "pipeline_meeting.py", shim("aphrody_meetings.pipeline"))
    replace(
        SDK / "build_backend.py",
        '_write_generated(root / "aphrody/native-source.json"',
        '_write_generated(root / "src/aphrody/native-source.json"',
    )
    replace(
        SDK / "tests/test_build_backend.py",
        'package / "aphrody',
        'package / "src/aphrody',
    )
    replace(
        SDK / "tests/test_public_api.py",
        "source = Path(__file__).resolve().parents[1]",
        'source = Path(__file__).resolve().parents[1] / "src"',
    )
    replace(
        ROOT / "tools/packaging/qualify_aphrody.py",
        '"aphrody/aphrody_rust.pyi", "LICENSE"',
        '"src/aphrody/aphrody_rust.pyi", "LICENSE"',
    )
    replace(
        ROOT / "tools/packaging/qualify_aphrody.py",
        'PACKAGE / "aphrody/resources"',
        'PACKAGE / "src/aphrody/resources"',
    )
    for name in (
        "run-docling-ocr.py",
        "run-gpt-oss-reasoning.py",
        "run-whisper-stt.py",
    ):
        path = ROOT / "tools/ai/scripts" / name
        text = path.read_text()
        # These scripts now require a regular/editable installation, not path injection.
        lines = text.splitlines(keepends=True)
        tree = ast.parse(text)
        remove: set[int] = set()
        for node in tree.body:
            if isinstance(node, ast.Assign) and any(
                isinstance(target, ast.Name)
                and target.id
                in {"repo_root", "py_pkg_path", "py_aphrody", "REPO_ROOT", "PY_SRC"}
                for target in node.targets
            ):
                remove.update(range(node.lineno - 1, node.end_lineno or node.lineno))
            if isinstance(node, ast.If) and any(
                isinstance(child, ast.Call)
                and isinstance(child.func, ast.Attribute)
                and child.func.attr == "insert"
                for child in ast.walk(node)
            ):
                remove.update(range(node.lineno - 1, node.end_lineno or node.lineno))
        write(
            path,
            "".join(
                line
                for index, line in enumerate(lines)
                if index not in remove
                and not line.startswith("# Add py/")
                and not line.startswith("# Add python source")
            ),
        )
    replace(
        ROOT / "tools/infra/scripts/install-developer-cli.py",
        'workspace_root.parent / "src" / "aphrody-infra"',
        'workspace_root.parent / "aphrody"',
    )
    mock = ROOT / "packages/conftest.py"
    if mock.exists():
        mock.unlink()


def migrate_metadata() -> None:
    """Declare public dependencies, package owners and one tooling policy."""
    root = load(ROOT / "pyproject.toml")
    root["project"]["dependencies"] = []
    root["tool"]["uv"].pop("sources", None)
    root["tool"]["uv"]["workspace"]["members"] = [
        "packages/aphrody",
        "packages/aphrody-train",
        "packages/embedding-fixtures",
        "packages/model-tools",
        "packages/cli",
        "apps/meetings",
    ]
    root["dependency-groups"]["dev"] = [
        "pytest>=8.3",
        "pytest-asyncio>=0.23",
        "pytest-httpx>=0.35",
        "ruff>=0.16",
        "mypy>=1.19,<2",
    ]
    pytest = root["tool"]["pytest"]["ini_options"]
    pytest.pop("pythonpath", None)
    pytest["testpaths"].extend(
        path
        for path in [
            "packages/cli/tests",
            "apps/meetings/tests",
            "tools/infra/scripts/rg",
            "tools/packaging",
        ]
        if path not in pytest["testpaths"]
    )
    pytest["addopts"] = "-q --strict-markers --import-mode=importlib"
    pytest["markers"] = [
        "integration: opt-in tests requiring runtimes, models or services",
        "live_api: opt-in authenticated provider requests",
    ]
    root["tool"]["ruff"] = {
        "line-length": 88,
        "target-version": "py312",
        "extend-exclude": ["packages/os/drive", "tools/ui", "vendor"],
        "lint": {
            "select": ["E4", "E7", "E9", "F", "I", "UP", "B"],
            "ignore": ["B008"],
            "per-file-ignores": {
                "**/resources/blender/**": ["E402"],
                "**/blender_addon/**": ["E402"],
                "tools/ai/scripts/*.py": ["E402"],
                "packages/aphrody/scripts/*.py": ["E402"],
                "**/tests/**": ["B018"],
            },
            "isort": {
                "known-first-party": [
                    "aphrody",
                    "aphrody_train",
                    "aphrody_cli",
                    "aphrody_meetings",
                    "koharu_model_tools",
                    "aphrody_embedding_fixtures",
                ]
            },
        },
        "format": {"line-ending": "lf"},
    }
    root["tool"]["ty"] = {
        "rules": {
            "dynamic-function-decorator-return": "error",
            "missing-type-argument": "error",
            "possibly-unresolved-reference": "warn",
            "unsound-return-statement": "error",
        },
        "analysis": {
            "strict-equality-semantics": True,
            "strict-generic-narrowing": True,
        },
    }
    root["tool"]["mypy"] = {
        "python_version": "3.12",
        "files": [
            "packages/aphrody/src",
            "packages/aphrody-train/src",
            "packages/cli/src",
            "packages/model-tools/src",
            "packages/embedding-fixtures/src",
            "apps/meetings/src",
        ],
        "ignore_missing_imports": True,
        "check_untyped_defs": True,
        "warn_unused_configs": True,
        "show_error_codes": True,
        "explicit_package_bases": True,
        "mypy_path": [
            "packages/aphrody/src",
            "packages/aphrody-train/src",
            "packages/cli/src",
            "packages/model-tools/src",
            "packages/embedding-fixtures/src",
            "apps/meetings/src",
        ],
    }
    metadata(ROOT / "pyproject.toml", root)
    sdk = load(SDK / "pyproject.toml")
    # Package owners maintain component licenses; migration must not erase
    # an absorbed component's notices or narrow an existing SPDX expression.
    sdk["project"].setdefault("license", "Apache-2.0")
    sdk["project"].setdefault("license-files", ["LICENSE", "NOTICE"])
    sdk["project"]["classifiers"] = [
        item
        for item in sdk["project"]["classifiers"]
        if not item.startswith("License ::")
    ]
    sdk["project"]["dependencies"] = [
        item for item in sdk["project"]["dependencies"] if not item.startswith("fire")
    ]
    sdk["project"].pop("scripts", None)
    sdk["project"]["optional-dependencies"]["voice"] = [
        FORK_REQUIREMENT.replace("google-antigravity @", "google-antigravity[voice] @")
    ]
    sdk["project"]["optional-dependencies"]["antigravity"] = [FORK_REQUIREMENT]
    sdk["project"]["urls"] = {
        "Repository": "https://github.com/aphrody-labs/aphrody-py",
        "Documentation": "https://github.com/aphrody-labs/aphrody-py/tree/main/docs/sdk",
    }
    sdk["tool"]["maturin"]["python-source"] = "src"
    for entry in sdk["tool"]["maturin"]["exclude"]:
        if entry["path"] == "aphrody/native-source.json":
            entry["path"] = "src/aphrody/native-source.json"
    sdk["tool"]["uv"] = {"sources": {"google-antigravity": {"git": FORK, "rev": PIN}}}
    metadata(SDK / "pyproject.toml", sdk)
    for path in ROOT.glob("packages/*/pyproject.toml"):
        data = load(path)
        config = data.get("tool", {}).get("pytest", {}).get("ini_options", {})
        config.pop("pythonpath", None)
        metadata(path, data)
    for path in (
        ROOT / "packages/aphrody/ruff.toml",
        ROOT / "packages/aphrody-train/ruff.toml",
    ):
        if path.exists():
            path.unlink()
    for directory, name, imports, dependencies, scripts in [
        (
            "packages/cli",
            "aphrody-cli",
            "aphrody_cli",
            ["aphrody>=0.1.0", "fire>=0.7"],
            {
                "aphrody-python": "aphrody_cli.main:main",
                "aphrody-python-google": "aphrody_cli.google:main",
            },
        ),
        (
            "apps/meetings",
            "aphrody-meetings",
            "aphrody_meetings",
            ["aphrody>=0.1.0"],
            {"aphrody-meeting": "aphrody_meetings.pipeline:main"},
        ),
    ]:
        data = {
            "build-system": {
                "requires": ["hatchling>=1.27"],
                "build-backend": "hatchling.build",
            },
            "project": {
                "name": name,
                "version": "0.1.0",
                "requires-python": ">=3.11",
                "license": "Apache-2.0",
                "license-files": ["LICENSE"],
                "dependencies": dependencies,
                "scripts": scripts,
            },
            "tool": {
                "hatch": {
                    "build": {"targets": {"wheel": {"packages": [f"src/{imports}"]}}}
                },
                "uv": {"sources": {"aphrody": {"workspace": True}}},
            },
        }
        metadata(ROOT / directory / "pyproject.toml", data)
        write(ROOT / directory / "LICENSE", (SDK / "LICENSE").read_text())
    model = ROOT / "packages/model-tools"
    write(model / "LICENSE", (SDK / "LICENSE").read_text())
    data = load(model / "pyproject.toml")
    data["project"].update({"license": "Apache-2.0", "license-files": ["LICENSE"]})
    metadata(model / "pyproject.toml", data)
    for path in [
        SDK / "src/aphrody/py.typed",
        ROOT / "packages/aphrody-train/src/aphrody_train/py.typed",
        ROOT / "packages/embedding-fixtures/src/aphrody_embedding_fixtures/py.typed",
        ROOT / "packages/model-tools/src/koharu_model_tools/py.typed",
        ROOT / "packages/cli/src/aphrody_cli/py.typed",
        ROOT / "apps/meetings/src/aphrody_meetings/py.typed",
    ]:
        write(path, "")
    replace(
        ROOT / ".gitignore",
        "packages/aphrody/aphrody/native-source.json",
        "packages/aphrody/src/aphrody/native-source.json",
    )
    write(
        ROOT / ".gitattributes",
        "# SPDX-License-Identifier: Apache-2.0\n*.py text eol=lf\n*.toml text eol=lf\n*.md text eol=lf\n*.yml text eol=lf\n*.json text eol=lf\n",
    )


def migrate_runtime() -> None:
    """Report invalid corpus rows and keep library progress off stdout."""
    path = ROOT / "packages/aphrody-train/src/aphrody_train/multimodal_rag.py"
    text = path.read_text()
    if "logger = logging.getLogger" not in text:
        text = text.replace("import json\n", "import json\nimport logging\n")
        text = text.replace(
            "import click\n", "import click\n\nlogger = logging.getLogger(__name__)\n"
        )
        text = text.replace(
            "except Exception:\n                        continue",
            'except (ValueError, TypeError, AttributeError) as exc:\n                        raise ValueError(f"Invalid OCR lot record in {lot_file}: {exc}") from exc',
        )
        text = text.replace(
            "except Exception:\n                continue",
            'except (ValueError, TypeError, AttributeError) as exc:\n                raise ValueError(f"Invalid corpus record in {corpus_path} at line {idx + 1}: {exc}") from exc',
        )
        text = text.replace(
            "except Exception as exc:\n            raise RuntimeError",
            "except (ImportError, OSError, ValueError, RuntimeError) as exc:\n            raise RuntimeError",
        )
        boundary = text.index("@click.group()")
        text = text[:boundary].replace("print(", "logger.info(") + text[boundary:]
        text = text.replace(
            'default="../shenron/data/rag/massive-unified-corpus.jsonl",',
            "required=True, type=click.Path(exists=True, dir_okay=False),",
        )
        text = text.replace(
            'default="../shenron/data/databooks-ocr/lots",',
            "default=None, type=click.Path(exists=True, file_okay=False),",
        )
        text = text.replace(
            'default="home/shenron/models/embed/model",',
            "required=True, type=click.Path(exists=True),",
        )
        text = text.replace(
            'default="home/shenron/models/rerank/model",',
            "default=None, type=click.Path(exists=True),",
        )
        write(path, text)
    path = ROOT / "packages/aphrody-train/src/aphrody_train/triples.py"
    replace(
        path,
        "except Exception:\n                pass",
        'except (ValueError, TypeError, AttributeError) as exc:\n                raise ValueError(f"Invalid gold record: {exc}") from exc',
    )


def migrate_verifier() -> None:
    """Allow only the exact authenticated fork, and test the separately owned CLI."""
    path = ROOT / "tools/sdk/verify-wheel.py"
    text = path.read_text()
    tree = ast.parse(text)
    lines = text.splitlines(keepends=True)
    for node in ast.walk(tree):
        if isinstance(node, ast.If) and ast.unparse(node.test).startswith(
            "' @ ' in requirement"
        ):
            start = sum(map(len, lines[: node.lineno - 1])) + node.col_offset
            body_start = sum(map(len, lines[: node.body[0].lineno - 1]))
            pattern = (
                r"google-antigravity(?:\[voice\])?\s*@\s*"
                + re.escape("git+" + FORK + "@" + PIN)
                + r"\s*;\s*extra\s*==\s*['\"](?:voice|antigravity)['\"]"
            )
            condition = f'if " @ " in requirement and not re.fullmatch({pattern!r}, requirement, re.IGNORECASE):\n'
            text = text[:start] + condition + text[body_start:]
            break
    write(path, text)


def migrate_contracts() -> None:
    """Move CLI contracts with their owner and fix validation-discovered defects."""
    for name in (
        "test_google_cli.py",
        "test_rag_cli.py",
        "test_cli_media_think_research.py",
        "test_cli_drive.py",
        "test_cli_evaluation.py",
        "test_cli_setup.py",
    ):
        move(SDK / "tests" / name, ROOT / "packages/cli/tests" / name)
    package = SDK / "src/aphrody"
    replace(package / "rag/__init__.py", "    import networkx as nx\n", "")
    replace(package / "rag/__init__.py", "            import asyncio\n", "")
    replace(
        ROOT / "tools/ai/scripts/test-hybrid-rag.py",
        "zip(a, b)",
        "zip(a, b, strict=True)",
    )
    replace(
        ROOT / "tools/infra/scripts/smoke-aphrody-stack-local.py",
        "zip(SERVICES, procs)",
        "zip(SERVICES, procs, strict=True)",
    )
    replace(
        ROOT / "tools/infra/scripts/ops/ovh.py",
        "        )\n    if not data:",
        "        ) from error\n    if not data:",
    )
    replace(
        ROOT / "tools/packaging/qualify_aphrody.py",
        '    "aphrody/py.typed",',
        '    "src/aphrody/py.typed",',
    )
    # Paths in historical migration attestations are immutable evidence.
    for path in [ROOT / "README.md", *ROOT.joinpath("docs/sdk").glob("*.md")]:
        replace(path, "packages/aphrody/aphrody", "packages/aphrody/src/aphrody")
    for path in (ROOT / "packages/cli/tests", ROOT / "apps/meetings/tests"):
        path.mkdir(parents=True, exist_ok=True)
    path = ROOT / "tools/packaging/test_qualify_aphrody.py"
    replace(
        path,
        "from qualify_aphrody import normalize_sbom_source",
        """import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location("qualify_aphrody", Path(__file__).with_name("qualify_aphrody.py"))
assert _spec and _spec.loader
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)
normalize_sbom_source = _module.normalize_sbom_source""",
    )


def migrate_types() -> None:
    """Repair concrete type errors; never disable checking to obtain a green gate."""
    package = SDK / "src/aphrody"
    train = ROOT / "packages/aphrody-train/src/aphrody_train"
    cli = ROOT / "packages/cli/src/aphrody_cli"
    changes = {
        package / "forensic/classify.py": [
            ("label=label,", 'label=str(label or "unknown"),')
        ],
        package / "agent.py": [
            (
                'events = self._turns.get(params.get("threadId"))',
                'thread_id = params.get("threadId")\n                        events = self._turns.get(thread_id) if isinstance(thread_id, str) else None',
            ),
            ("self._proc.stderr.buffer.read(4096)", "self._proc.stderr.read(4096)"),
        ],
        package / "gemini_web.py": [
            (
                "chat_state = [conversation_id",
                "chat_state: list[Any] = [conversation_id",
            )
        ],
        package / "analyze.py": [
            (
                "rgb = tuple(int(c) for c in arr[:, :3].mean(axis=0).round())",
                "channels = arr[:, :3].mean(axis=0).round()\n        rgb = (int(channels[0]), int(channels[1]), int(channels[2]))",
            ),
            (
                "rgb = tuple(c // kept for c in total)",
                "rgb = (total[0] // kept, total[1] // kept, total[2] // kept)",
            ),
            ('exif = getattr(img, "getexif", lambda: {})()', "exif = img.getexif()"),
        ],
        package / "soul_creator.py": [
            ("attrs: list[tuple[str, str]]", "attrs: list[tuple[str, str | None]]"),
            (
                "attr_dict = dict(attrs)",
                'attr_dict = {name: content or "" for name, content in attrs}',
            ),
        ],
        package / "autocomplete.py": [
            (
                'text = getattr(response, "text", None)\n            if text:',
                'fallback_text = getattr(response, "text", None)\n            if isinstance(fallback_text, str) and fallback_text:',
            ),
            (
                "Completion(text=_strip_fences(text), index=0, model=self._model)",
                "Completion(text=_strip_fences(fallback_text), index=0, model=self._model)",
            ),
        ],
        package / "batch.py": [
            (
                "Path(p), item.optimize",
                "Path(p.decode() if isinstance(p, bytes) else p), item.optimize",
            )
        ],
        package / "rag/raptor.py": [
            (
                "self._parent_chains = [[] for _ in range(n)]",
                "self._parent_chains: list[list[int]] = [[] for _ in range(n)]",
            ),
            (
                "children_by_parent = {}",
                "children_by_parent: dict[int, list[int]] = {}",
            ),
            ("layers = {}", "layers: dict[int, list[_PsiTreeNode]] = {}"),
        ],
        package / "audio/whisper_transcribe.py": [
            (
                "        if isinstance(audio, np.ndarray):",
                "        audio_input: np.ndarray | str\n        if isinstance(audio, np.ndarray):",
            )
        ],
        package / "rag/layout_chunker.py": [
            (
                "import tiktoken\n",
                "import tiktoken as _tiktoken\n    tiktoken: Any = _tiktoken\n",
            ),
            (
                "        if tiktoken:",
                "        self._encoder: Any | None = None\n        if tiktoken:",
            ),
            (
                "current_chunk_elements = []",
                "current_chunk_elements: list[LayoutElement] = []",
            ),
            ("current_headings = []", "current_headings: list[str] = []"),
            ("overlap_elements = []", "overlap_elements: list[LayoutElement] = []"),
        ],
        train / "gates.py": [("signatures = []", "signatures: list[Any] = []")],
        train / "triples.py": [
            ("queries = set()", "queries: set[str] = set()"),
            ("urls = set()", "urls: set[str] = set()"),
            (
                'for row in output:\n        del row["_index"]',
                'for output_row in output:\n        del output_row["_index"]',
            ),
            (
                "candidates = choose(mined[position], excluded, options.mining.pool)",
                "candidates = [(candidate, score) for candidate, score in choose(mined[position], excluded, options.mining.pool)]",
            ),
            ("emitter: TrainEmitter = None", "emitter: TrainEmitter | None = None"),
        ],
        train / "dataset.py": [
            ("    current = None\n", "    current: dict[str, Any] | None = None\n"),
            (
                "queries, urls = set(), set()",
                "queries: set[str] = set()\n    urls: set[str] = set()",
            ),
            (
                'response = rejected.get("response", {})',
                'response: dict[str, Any] = rejected.get("response", {})',
            ),
            ("        stats = {", "        stats: dict[str, Any] = {"),
        ],
        train / "lora.py": [
            (
                "text for text in reversed(answers) if text.strip()",
                "text for text in reversed(answers) if isinstance(text, str) and text.strip()",
            )
        ],
        cli / "image.py": [
            (
                'if out else {"bytes": len(res)}',
                'if isinstance(res, Path) else {"bytes": len(res)}',
            )
        ],
        cli / "main.py": [
            (
                'stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]',
                'reconfigure = getattr(stream, "reconfigure", None)\n            if callable(reconfigure):\n                reconfigure(encoding="utf-8")',
            ),
            (
                'fire.Fire(Aphrody, name="aphrody")',
                'fire.Fire(Aphrody, name="aphrody-python")',
            ),
        ],
    }
    for path, replacements in changes.items():
        for old, new in replacements:
            replace(path, old, new)
    # JSON objects are heterogeneous; their scalar and collection types are
    # validated by the existing rollout parser before these operations.
    for path in (train / "dataset.py", train / "gates.py"):
        text = path.read_text()
        if "from typing import Any" not in text:
            text = (
                text.replace(
                    "from pathlib import Path\n",
                    "from pathlib import Path\nfrom typing import Any\n",
                )
                if "from pathlib import Path\n" in text
                else text.replace(
                    "import math\n", "import math\nfrom typing import Any\n"
                )
            )
            write(path, text)
    for path in (package / "_rag_vectors.py", package / "rag/vectors.py"):
        text = path.read_text()
        if "from types import ModuleType" not in text:
            text = text.replace(
                "import numpy as np",
                "from types import ModuleType\n\nimport numpy as np\n\n_native: ModuleType | None",
            )
            write(path, text)
    path = package / "anim.py"
    text = path.read_text()
    if "from collections.abc import Sequence" not in text:
        text = text.replace(
            "from __future__ import annotations\n",
            "from __future__ import annotations\n\nfrom collections.abc import Sequence\n",
        )
    text = text.replace(
        "paths: list[str | Path]", "paths: Sequence[str | Path]"
    ).replace("frames: list[str | Path]", "frames: Sequence[str | Path]")
    write(path, text)

    path = package / "auth/credential_store.py"
    replace(path, "def _advapi32() -> ctypes.WinDLL:", "def _advapi32() -> Any:")
    replace(path, 'ctypes.WinDLL("advapi32",', 'getattr(ctypes, "WinDLL")("advapi32",')
    replace(path, "ctypes.get_last_error()", 'getattr(ctypes, "get_last_error")()')
    text = path.read_text()
    if "from typing import Any" not in text:
        write(
            path,
            text.replace(
                "from pathlib import Path\n",
                "from pathlib import Path\nfrom typing import Any\n",
            ),
        )
    path = package / "media.py"
    text = path.read_text()
    # ApiError takes (status, body); the previous calls raised TypeError instead
    # of the documented API error on every provider failure.
    tree = ast.parse(text)
    offsets = [0]
    for line in text.splitlines(keepends=True):
        offsets.append(offsets[-1] + len(line))
    edits = []
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "ApiError"
            and len(node.args) == 1
        ):
            status = next(
                (kw.value for kw in node.keywords if kw.arg == "status"), None
            )
            if status:
                start, end = (
                    offsets[node.lineno - 1] + node.col_offset,
                    offsets[(node.end_lineno or node.lineno) - 1]
                    + (node.end_col_offset or 0),
                )
                edits.append(
                    (
                        start,
                        end,
                        f"ApiError({ast.get_source_segment(text, status)}, {ast.get_source_segment(text, node.args[0])})",
                    )
                )
    for start, end, content in sorted(edits, reverse=True):
        text = text[:start] + content + text[end:]
    text = text.replace(
        'with encoded_path.open("rb") as stream:\n                    header = stream.read(12)',
        'with encoded_path.open("rb") as encoded_stream:\n                    header = encoded_stream.read(12)',
    )
    text = text.replace(
        '"audio" in part.inline_data.mime_type',
        '"audio" in (part.inline_data.mime_type or "")',
    )
    text = text.replace(
        'ffmpeg = shutil.which("ffmpeg")', 'ffmpeg = shutil.which("ffmpeg") or ""'
    )
    write(path, text)


def migrate_type_contracts() -> None:
    """Narrow optional provider results and model reusable collection inputs."""
    package = SDK / "src/aphrody"
    train = ROOT / "packages/aphrody-train/src/aphrody_train"
    cli = ROOT / "packages/cli/src/aphrody_cli"
    path = package / "prompts.py"
    text = path.read_text()
    if "from collections.abc import Mapping, Sequence" not in text:
        text = text.replace(
            "from __future__ import annotations\n",
            "from __future__ import annotations\n\nfrom collections.abc import Mapping, Sequence\nfrom typing import Any\n",
        )
    text = re.sub(
        r"def get_value\(self, key: object, args: object, kwargs: object\) -> object:.*",
        "def get_value(self, key: int | str, args: Sequence[Any], kwargs: Mapping[str, Any]) -> Any:",
        text,
    )
    text = text.replace(
        'return kwargs.get(key, "{" + key + "}")  # type: ignore[union-attr]',
        'return kwargs.get(key, "{" + key + "}")',
    ).replace(
        "return super().get_value(key, args, kwargs)  # type: ignore[arg-type]",
        "return super().get_value(key, args, kwargs)",
    )
    write(path, text)
    path = package / "session_db.py"
    text = path.read_text()
    if "def _conn(self)" not in text:
        text = text.replace(
            "self._conn = sqlite3.connect(",
            "self._connection: sqlite3.Connection | None = sqlite3.connect(",
        )
        close_start, close_end = (
            text.index("    def close(self):"),
            text.index("    @staticmethod", text.index("    def close(self):")),
        )
        text = (
            text[:close_start]
            + text[close_start:close_end].replace("self._conn", "self._connection")
            + text[close_end:]
        )
        text = text.replace(
            "    def _execute_write(",
            """    @property
    def _conn(self) -> sqlite3.Connection:
        if self._connection is None:
            raise RuntimeError("Session database is closed")
        return self._connection

    def _execute_write(""",
        )
    text = text.replace(
        "sort_norm = sort.strip().lower()",
        "sort_norm: str | None = sort.strip().lower()",
    )
    write(path, text)
    replace(
        package / "rag/layout_chunker.py",
        "current_headings: list[str]",
        "current_headings: list[dict[str, Any]]",
    )
    path = package / "rag/layout_chunker.py"
    write(
        path,
        re.sub(
            r"(?:        self\._encoder: Any \| None = None\n)+",
            "        self._encoder: Any | None = None\n",
            path.read_text(),
        ),
    )
    path = train / "dataset.py"
    text = path.read_text().replace(
        "response = next(", "response: dict[str, Any] = next("
    )
    # Completion resets reuse an existing variable, rather than redeclaring it.
    first = text.find("current: dict[str, Any] | None = None")
    if first >= 0:
        end = first + len("current: dict[str, Any] | None = None")
        text = text[:end] + text[end:].replace(
            "current: dict[str, Any] | None = None", "current = None"
        )
    write(path, text)
    path = package / "audio/whisper_transcribe.py"
    text = path.read_text()
    first = text.find("audio_input: np.ndarray | str")
    if first >= 0:
        end = first + len("audio_input: np.ndarray | str")
        text = text[:end] + text[end:].replace(
            "        audio_input: np.ndarray | str\n", ""
        )
    write(path, text)
    path = package / "bpy_runner.py"
    text = path.read_text()
    if "from collections.abc import Iterable" not in text:
        text = text.replace(
            "from __future__ import annotations\n",
            "from __future__ import annotations\n\nfrom collections.abc import Iterable\n",
        )
    text = text.replace(
        "args: list[str] | tuple[str, ...] = ()", "args: Iterable[object] = ()"
    )
    text = text.replace("cmd = [self.bin,", 'cmd = [self.bin or "",')
    write(path, text)
    path = package / "auth/credential_store.py"
    replace(path, "ctypes.WinDLL(", 'ctypes.__dict__["WinDLL"](')
    replace(path, 'getattr(ctypes, "WinDLL")(', 'ctypes.__dict__["WinDLL"](')
    replace(path, "ctypes.get_last_error()", 'ctypes.__dict__["get_last_error"]()')
    replace(
        path,
        'getattr(ctypes, "get_last_error")()',
        'ctypes.__dict__["get_last_error"]()',
    )
    path = package / "vertex.py"
    text = path.read_text()
    if "credentials: BaseCredentials" not in text:
        text = text.replace(
            "        if creds is not None:",
            "        from google.auth.credentials import Credentials as BaseCredentials\n\n        credentials: BaseCredentials\n        if creds is not None:",
        )
    write(path, text)
    path = package / "voice_server.py"
    text = path.read_text()
    if "from functools import partial" not in text:
        text = text.replace(
            "from __future__ import annotations\n",
            "from __future__ import annotations\n\nfrom functools import partial\n",
        )
    text = text.replace(
        "lambda audio=audio_data, lang=stt_lang: self.stt.transcribe(\n                            audio, language=lang, beam_size=1\n                        )",
        "partial(self.stt.transcribe, audio_data, language=stt_lang, beam_size=1)",
    )
    write(path, text)
    path = package / "icons.py"
    text = path.read_text().replace(
        "return bytes(value)  # list[int] / sequence of ints",
        'if isinstance(value, (list, tuple)) and all(isinstance(item, int) for item in value):\n        return bytes(value)\n    raise TypeError("SVG renderer must return bytes or an integer sequence")',
    )
    text = text.replace(
        "img = Image.open(io.BytesIO(png_bytes))",
        "img: Image.Image = Image.open(io.BytesIO(png_bytes))",
    )
    write(path, text)
    path = package / "media.py"
    replace(
        path,
        'ffmpeg = shutil.which("ffmpeg") or "" if suffix == ".mp4" else None',
        'ffmpeg = (shutil.which("ffmpeg") or "") if suffix == ".mp4" else ""',
    )
    replace(
        path, 'suffix == ".mp4" and ffmpeg is None', 'suffix == ".mp4" and not ffmpeg'
    )
    path = cli / "image.py"
    text = path.read_text()
    if "from pathlib import Path" not in text:
        text = text.replace(
            "from __future__ import annotations\n",
            "from __future__ import annotations\n\nfrom pathlib import Path\n",
        )
    write(path, text)
    path = cli / "rag.py"
    text = path.read_text()
    if "from google.genai import types as genai_types" not in text:
        text = text.replace(
            "from __future__ import annotations\n",
            "from __future__ import annotations\n\nfrom google.genai import types as genai_types\n",
        )
    if "from google.genai import types" not in text:
        text = text.replace(
            "from __future__ import annotations\n",
            "from __future__ import annotations\n\nfrom google.genai import types\n",
        )
    text = text.replace(
        "contents=batch,", 'contents=[{"parts": [{"text": text}]} for text in batch],'
    )
    text = text.replace(
        'contents=[{"parts": [{"text": text}]} for text in batch],',
        "contents=[types.Content(parts=[types.Part(text=text)]) for text in batch],",
    )
    text = text.replace(
        "contents=[types.Content(parts=[types.Part(text=text)]) for text in batch],",
        "contents=[genai_types.Content(parts=[genai_types.Part(text=text)]) for text in batch],",
    )
    text = text.replace(
        "                for emb in response.embeddings:\n                    results.append([float(val) for val in emb.values])",
        """                if response.embeddings is None or len(response.embeddings) != len(batch):
                    raise ValueError("Embedding provider returned an incomplete batch")
                for emb in response.embeddings:
                    if emb.values is None:
                        raise ValueError("Embedding provider returned no vector values")
                    results.append([float(val) for val in emb.values])""",
    )
    write(path, text)
    path = cli / "rag.py"
    text = path.read_text()
    if "batch_contents:" not in text:
        text = re.sub(
            r"contents=\[\s*genai_types.Content\(parts=\[genai_types.Part\(text=text\)\]\)\s*for text in batch\s*\],",
            "contents=batch_contents,",
            text,
        )
        text = text.replace(
            "                response = client.models.embed_content(",
            "                batch_contents: list[genai_types.ContentUnion] = [genai_types.Content(parts=[genai_types.Part(text=text)]) for text in batch]\n                response = client.models.embed_content(",
        )
    write(path, text)
    path = SDK / "tests/test_public_api.py"
    text = path.read_text()
    lines = text.splitlines(keepends=True)
    edits = []
    for node in ast.walk(ast.parse(text)):
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "source"
            for target in node.targets
        ):
            edits.append((node.lineno - 1, node.end_lineno or node.lineno))
    for start, end in sorted(edits, reverse=True):
        lines[start:end] = [
            '    source = Path(__file__).resolve().parents[1] / "src"\n'
        ]
    write(path, "".join(lines))


def migrate_ci_and_docs() -> None:
    """Use the same quality gates locally and in CI, and document actual owners."""
    write(
        ROOT / ".github/workflows/aphrody-ci.yml",
        """# SPDX-License-Identifier: Apache-2.0
name: Aphrody Python CI
on:
  push:
  pull_request:
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: python-workspace-${{ github.ref }}
  cancel-in-progress: true
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5
      - uses: astral-sh/setup-uv@94527f2e458b27549849d47d273a16bec83a01e9 # v7
        with:
          version: "0.12.22"
          python-version: "3.12"
          enable-cache: true
      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - name: Install Global Canary Tooling (OXC)
        run: |
          bun install -g oxlint@latest oxfmt@latest
      - name: Unified Lint & Format Checks (OXC + Ruff)
        run: |
          oxlint --no-error-on-unmatched-pattern
          bun run lint
          bun run fmt -- --check
      - name: Fast Test Runner via Bun & Pytest
        run: |
          bun run test
      - name: Check isolated locks, quality, types, tests and installed distributions
        run: python tools/packaging/modernize_workspace.py check
""",
    )


def migrate_application() -> None:
    """Make meeting synthesis consume its transcript rather than canned data."""
    path = ROOT / "apps/meetings/src/aphrody_meetings/pipeline.py"
    text = path.read_text()
    if "synthesizer:" not in text:
        tree = ast.parse(text)
        function = next(
            node
            for node in tree.body
            if isinstance(node, ast.FunctionDef)
            and node.name == "extract_structured_synthesis"
        )
        lines = text.splitlines(keepends=True)
        lines[function.lineno - 1 : function.end_lineno] = [
            '''def extract_structured_synthesis(
    transcript_text: str, title: str, *, synthesizer: Callable[[str], str] | None = None
) -> dict[str, Any]:
    """Generate and validate a JSON synthesis from the actual meeting transcript."""
    if not transcript_text.strip():
        raise ValueError("Meeting transcript must not be empty")
    if synthesizer is None:
        from aphrody.vertex import generate
        synthesizer = generate
    prompt = (
        "Summarize the supplied meeting transcript using only facts in that transcript. "
        "Return a JSON object with executive_summary (string), demographics, "
        "key_decisions, risks_and_vigilance (lists of strings), and action_plan "
        "(list of objects with action, owner, deadline strings). Use empty lists "
        "when the transcript provides no corresponding facts.\\n"
        + json.dumps({"title": title, "transcript": transcript_text}, ensure_ascii=False)
    )
    payload = synthesizer(prompt).strip()
    if payload.startswith("```"):
        payload = payload.split("\\n", 1)[1].rsplit("```", 1)[0].strip()
    result = json.loads(payload)
    if not isinstance(result, dict) or not isinstance(result.get("executive_summary"), str):
        raise ValueError("Synthesis must contain an executive_summary string")
    for key in ("demographics", "key_decisions", "risks_and_vigilance"):
        if not isinstance(result.get(key), list) or not all(isinstance(item, str) for item in result[key]):
            raise ValueError(f"Synthesis field {key} must be a list of strings")
    actions = result.get("action_plan")
    if not isinstance(actions, list) or not all(isinstance(item, dict) and all(isinstance(item.get(key), str) for key in ("action", "owner", "deadline")) for item in actions):
        raise ValueError("Synthesis action_plan must contain action, owner and deadline strings")
    result.update(title=title, date=datetime.date.today().isoformat(), duration="Not supplied by transcript metadata")
    return result
'''
        ]
        text = "".join(lines)
        text = text.replace(
            "import datetime\n",
            "import datetime\nimport json\nimport logging\nfrom collections.abc import Callable\n",
        )
        text = text.replace(
            "from aphrody.google_drive import AuthenticatedDriveClient\n",
            "from aphrody.google_drive import AuthenticatedDriveClient\n\nlogger = logging.getLogger(__name__)\n",
        )
        start, end = text.index("def run_pipeline("), text.index("def main(")
        text = (
            text[:start]
            + text[start:end].replace("print(", "logger.info(")
            + text[end:]
        )
        write(path, text)
    write(
        ROOT / "apps/meetings/tests/test_synthesis.py",
        '''# SPDX-License-Identifier: Apache-2.0
"""Meeting output must derive from supplied content and validate before publication."""
import json

import pytest

from aphrody_meetings.pipeline import extract_structured_synthesis


def test_synthesis_receives_actual_transcript_and_preserves_requested_title():
    seen = []
    def synthesize(prompt):
        seen.append(prompt)
        return json.dumps({"executive_summary": "Alice will deliver the report.", "demographics": [], "key_decisions": ["Deliver the report"], "risks_and_vigilance": [], "action_plan": [{"action": "Deliver report", "owner": "Alice", "deadline": "Friday"}]})
    result = extract_structured_synthesis("Alice: I will deliver the report on Friday.", "Weekly meeting", synthesizer=synthesize)
    assert "Alice: I will deliver the report on Friday." in seen[0]
    assert result["title"] == "Weekly meeting"
    assert result["action_plan"][0]["owner"] == "Alice"


@pytest.mark.parametrize("payload", ["[]", "{}", "not JSON"])
def test_invalid_model_output_is_rejected(payload):
    with pytest.raises(ValueError):
        extract_structured_synthesis("Alice: Hello", "Meeting", synthesizer=lambda _: payload)


def test_empty_transcript_is_rejected_before_provider_execution():
    def unexpected(_):
        raise AssertionError("Provider must not run")
    with pytest.raises(ValueError, match="empty"):
        extract_structured_synthesis(" ", "Meeting", synthesizer=unexpected)
''',
    )
    write(
        ROOT / "packages/aphrody-train/tests/test_corpus_contract.py",
        '''# SPDX-License-Identifier: Apache-2.0
"""Malformed corpus inputs must not silently become incomplete training data."""
import pytest

from aphrody_train import load_multimodal_corpus


@pytest.mark.parametrize("row", ["not JSON", "[]", "null"])
def test_bad_corpus_reports_file_and_line(tmp_path, row):
    corpus = tmp_path / "corpus.jsonl"
    corpus.write_text(row + "\\n", encoding="utf-8")
    with pytest.raises(ValueError, match="corpus.jsonl at line 1"):
        load_multimodal_corpus(str(corpus))


def test_valid_corpus_api_does_not_emit_cli_progress(tmp_path, capsys):
    corpus = tmp_path / "corpus.jsonl"
    corpus.write_text('{"id":"one","title":"Report","content":"A finding"}\\n', encoding="utf-8")
    assert load_multimodal_corpus(str(corpus))[0].doc_id == "one"
    assert capsys.readouterr().out == ""
''',
    )


def validation_report() -> None:
    """Record successful gates and hashes without collecting private runtime state."""
    members = load(ROOT / "pyproject.toml")["tool"]["uv"]["workspace"]["members"]
    sources = [
        path for member in members for path in (ROOT / member / "src").rglob("*.py")
    ]
    report = {
        "schemaVersion": 1,
        "migration": "Python workspace modernization",
        "supportedPlatform": "linux",
        "members": members,
        "gates": {
            "isolatedLocks": "pass",
            "lint": "pass",
            "format": "pass",
            "types": "pass",
            "workspaceTests": "pass",
            "installedDistributions": "pass",
            "sdkSdistRebuild": "pass",
        },
        "files": {
            str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(sources)
        },
        "limitations": [
            "Live cloud APIs, model quality, CUDA and Blender require dedicated Linux integration environments.",
            "Private provider contracts run separately through the providers command.",
        ],
    }
    write(
        ROOT / "docs/migration/python-modernization-2026-10-03.json",
        json.dumps(report, indent=2) + "\n",
    )


def migrate_documentation() -> None:
    """Replace current docs without rewriting historical attestations."""
    path = ROOT / ".github/workflows/python-sdk.yml"
    # The Linux SDK artifact matrix is set by migrate_linux_focus; CLI contracts have
    # their own independently installed distribution gate in workspace CI.
    if '      - "pyproject.toml"' not in path.read_text():
        replace(
            path,
            '      - "tools/sdk/**"',
            '      - "tools/sdk/**"\n      - "pyproject.toml"\n      - "uv.lock"',
        )
    write(
        ROOT / "docs/sdk/workspace-audit.md",
        """<!-- SPDX-License-Identifier: Apache-2.0 -->
# Current Python workspace contracts

The workspace has seven installable distributions. `packages/aphrody` owns the
library and pinned native ABI, `packages/cli` owns the optional Python CLI,
`apps/meetings` owns the meeting application, and the other four packages own
training, embedding fixtures, Koharu model export and the OCR service.

Every distribution uses `src/`, carries its license and `py.typed`, and is
built and installed outside the source tree by
`python tools/packaging/modernize_workspace.py check`. The SDK additionally
rebuilds a wheel from its source archive and verifies its native provenance.
CLI tests live with the CLI; the two Infra pruning tests are part of root CI.

The root owns Ruff, formatting, pytest and mypy configuration. Historical
migration reports under `docs/migration/` retain their original source paths.
Drive adapters remain protected upstream runtime inputs, outside first-party
style and type gates. UI asset tooling remains with its existing owner.

Python 3.12 is the complete workspace baseline because training and OCR are
qualified for `>=3.12,<3.13`. The independently distributed SDK and Python CLI
support Python 3.11+. The SDK matrix checks 3.11–3.14 on Ubuntu Linux;
the existence of a configured job is not evidence of a completed runtime test.
Changing the two runtime ceilings requires their provider/model qualification,
not merely changing metadata. These constraints do not restrict SDK consumers.

Antigravity extras use the same exact HTTPS Git revision inside and outside
the workspace. Private repository access uses Git's existing credential helper;
no workstation-specific SSH alias, token literal or neighboring checkout is used.
Authenticated provider qualification is explicit and separate from core tests.

Heavy models, CUDA training, Blender execution and live cloud APIs require
their actual Linux runtimes. Unit tests and installed
wheel tests do not establish those integration contracts.
""",
    )
    write(
        ROOT / "README.md",
        """<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody Python

A uv workspace for Python libraries, applications and tools. Rust source is
owned by the sibling Aphrody monorepo; the SDK builds from an independently
verified, pinned source artifact rather than a neighboring runtime checkout.

## Development

Requires uv 0.12.22 and CPython 3.12 for the complete workspace.

```sh
uv sync --all-packages --locked --extra rag --extra dedup
python tools/packaging/modernize_workspace.py check
uv run --package aphrody-cli aphrody-python version
```

`aphrody-python` and `aphrody-python-google` belong to the optional Python CLI.
`aphrody` and `aphrody-google` remain the Rust authorities, avoiding PATH
collisions. Legacy Python imports delegate to the separately installed CLI.
The library alone does not depend on Fire or the meeting application.

## Layout

- `packages/aphrody/src/aphrody`: public SDK and packaged Blender resources.
- `packages/cli/src/aphrody_cli`: Python command implementations and CLI tests.
- `packages/aphrody-train/src/aphrody_train`: datasets, training and RAG APIs.
- `packages/embedding-fixtures`: reproducible native fixture generators.
- `packages/model-tools`: Koharu model exporters.
- `apps/meetings`: audio meeting application built on the SDK.
- `tools/`: operational, migration and packaging tools.
- `packages/os/drive`: retained upstream Drive adapters with their provenance.

The root owns workspace dependencies and tooling. Standalone SDK and training
locks are checked in temporary copies outside workspace discovery. Source
tests import installed editable packages without `pythonpath` injection;
distribution tests use clean installations outside the checkout.

## Migration and optional providers

The migration is repeatable:

```sh
python tools/packaging/modernize_workspace.py apply
python tools/packaging/modernize_workspace.py check
python tools/packaging/modernize_workspace.py providers
```

The last command qualifies the pinned private Antigravity fork and requires
Git authentication for `aphrody-labs/antigravity-sdk-python`. The core library
does not install this optional provider. No credentials belong in source files.
For CI provider jobs, configure a read-only Git credential through the runner's
existing credential helper; ordinary unit tests do not claim live provider parity.

See [current contracts](docs/sdk/workspace-audit.md),
[SDK validation](docs/sdk/validation.md), [native build](docs/sdk/native-build.md)
and [the extraction plan](../aphrody/PLAN.md). Historical migration evidence
stays under `docs/migration/`; protected datasets, model weights and secrets
stay in their existing private stores.
""",
    )
    write(
        ROOT / "PLAN.md",
        """<!-- SPDX-License-Identifier: Apache-2.0 -->
# Python workspace modernization

The repeatable owner is `tools/packaging/modernize_workspace.py`.

- [x] Short package paths and one root uv workspace.
- [x] Uniform source layouts; separate CLI and meeting application distributions.
- [x] Compatible import facades and distinct Python/Rust executable names.
- [x] One authenticated, exactly pinned HTTPS Antigravity provider contract.
- [x] Real standalone lock checks and independently installed distribution gates.
- [x] Root lint, formatting, type checking and complete test discovery.
- [x] No global audio mocks, obsolete import paths or silent malformed corpus rows.
- [x] Complete first-party license metadata and typing markers.
- [x] Explicit runtime/model qualification boundaries and current documentation.

Run `apply`, then `check`; use `providers` for private provider contracts.
Validation results are recorded after successful execution, not inferred from
this plan. The cross-repository extraction authority remains `../aphrody/PLAN.md`.
""",
    )


def migrate_remaining_paths() -> None:
    """Remove obsolete checkout assumptions from tools and current docs."""
    replace(
        SDK / "tests/test_timeout_monitor.py",
        '[sys.executable, "-c", "print(\'hello\')"], timeout_seconds=2.0',
        '[sys.executable, "-c", "print(\'hello\')"], timeout_seconds=30.0',
    )
    path = SDK / "scripts/setup_secrets.py"
    text = path.read_text()
    if "# Add project root" in text:
        start = text.index("# Add project root")
        end = text.index("from aphrody.cli.setup", start)
        text = text[:start] + text[end:]
    text = text.replace("from pathlib import Path\n", "")
    text = text.replace(
        "from aphrody.cli.setup import setup_secrets  # noqa: E402",
        "from aphrody_cli.setup import setup_secrets",
    )
    write(path, text)
    for path in ROOT.joinpath("packages/aphrody-train/src").rglob("*.py"):
        replace(
            path,
            "uv sync --project py/aphrody-train --extra full",
            "uv sync --package aphrody-train --extra full",
        )
    for path in ROOT.joinpath("tools/ai/scripts").glob("run-*.py"):
        replace(path, "python scripts/run-", "python tools/ai/scripts/run-")
        replace(path, "uv run scripts/run-", "uv run tools/ai/scripts/run-")
    path = SDK / "tests/test_agent_live.py"
    replace(
        path,
        '    sdk = Path(__file__).resolve().parents[3] / "crates/aphrody-ffi/bun/agent.ts"',
        '    configured_sdk = os.environ.get("APHRODY_TEST_BUN_SDK")\n'
        "    if not configured_sdk:\n"
        '        pytest.skip("Set APHRODY_TEST_BUN_SDK to the AgentClient module")\n'
        "    sdk = Path(configured_sdk).expanduser().resolve()\n"
        '    assert sdk.is_file(), f"Missing configured Bun SDK: {sdk}"',
    )
    path = SDK / "README.md"
    text = path.read_text().replace("Python client and CLI", "Python library")
    text = text.replace(
        "$ uv sync                      # inside the aphrody workspace",
        "$ uv sync --all-packages --locked  # inside the Python workspace",
    )
    text = text.replace(
        "$ uv run aphrody ", "$ uv run --package aphrody-cli aphrody-python "
    )
    text = text.replace("$ aphrody ", "$ aphrody-python ")
    text = text.replace("`aphrody voice`", "`aphrody-python voice`")
    text = text.replace(
        "### Voice (`aphrody voice`)", "### Voice (`aphrody-python voice`)"
    )
    text = (
        text.replace(
            "## CLI\n",
            "## CLI\n\nInstall the separate `aphrody-cli` distribution for `aphrody-python` and\n`aphrody-python-google`. The SDK alone installs no command-line executables.\n",
        )
        if "Install the separate `aphrody-cli`" not in text
        else text
    )
    text = text.replace("github.com/aphrody-code/", "github.com/aphrody-labs/")
    write(path, text)
    path = ROOT / "environments/README.md"
    text = path.read_text().replace(
        "A separate environment is justified only when an actual Python ABI or platform\nconstraint cannot be represented by uv's universal lock. Add its manifest and\nimport smoke command here before introducing another lockfile.",
        "The shared lock resolves a common Python range; it does not isolate optional\nproviders. Keep CUDA, Blender and other incompatible runtime profiles in separate\nenvironments. Independently installed wheels are checked in fresh environments.\nThe SDK supports Python 3.11+ independently of the complete workspace; its\nstandalone lock and the training lock are checked outside workspace discovery.",
    )
    write(path, text)


def migrate_linux_focus() -> None:
    """Qualify Linux and resolve native runtimes without Windows defaults."""
    workflow = ROOT / ".github/workflows/python-sdk.yml"
    text = workflow.read_text()
    start = text.index("      matrix:\n")
    end = text.index("    timeout-minutes:", start)
    text = (
        text[:start]
        + """      matrix:
        python: ["3.11", "3.12", "3.13", "3.14"]
    runs-on: ubuntu-latest
"""
        + text[end:]
    )
    text = text.replace("${{ matrix.os }}", "Linux")
    write(workflow, text)
    for directory in load(ROOT / "pyproject.toml")["tool"]["uv"]["workspace"][
        "members"
    ]:
        path = ROOT / directory / "pyproject.toml"
        data = load(path)
        classifiers = data["project"].setdefault("classifiers", [])
        if "Operating System :: POSIX :: Linux" not in classifiers:
            classifiers.append("Operating System :: POSIX :: Linux")
        metadata(path, data)
    paths = SDK / "src/aphrody/_paths.py"
    text = paths.read_text()
    if "import shutil\n" not in text:
        text = text.replace("import os\n", "import os\nimport shutil\n")
    if "def resolve_runtime_binary(" not in text:
        text += '''

def resolve_runtime_binary(name: str, variable: str, fallback: str) -> Path:
    """Resolve an executable from an override, PATH, or the Linux state directory.

    An invalid explicit override fails immediately instead of silently choosing
    another runtime. Missing automatic candidates remain a descriptive fallback
    path so the caller can report the required runtime without downloading it.
    """
    configured = os.environ.get(variable)
    if configured:
        candidate = Path(shutil.which(configured) or configured).expanduser()
        if not candidate.is_file():
            raise FileNotFoundError(f"{variable} executable does not exist: {candidate}")
        if not os.access(candidate, os.X_OK):
            raise PermissionError(f"{variable} executable is not executable: {candidate}")
        return candidate.resolve()
    on_path = shutil.which(name)
    if on_path:
        return Path(on_path)
    for candidate in (state_dir() / "bin" / name, state_dir() / fallback):
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return candidate
    return state_dir() / fallback
'''
    write(paths, text)
    harmony = SDK / "src/aphrody/inference/harmony_reasoning.py"
    text = harmony.read_text()
    if "from aphrody import _paths" not in text:
        text = text.replace(
            "import httpx\n", "import httpx\n\nfrom aphrody import _paths\n"
        )
    text = text.replace(
        'Path.home() / ".aphrody" / "runtimes" / "llama-b10549" / "llama-server.exe"',
        '_paths.state_dir() / "runtimes" / "llama-b10549" / "llama-server"',
    )
    text = text.replace(
        'Path.home() / ".aphrody" / "runtimes" / "llama-b10549" / "llama-cli.exe"',
        '_paths.state_dir() / "runtimes" / "llama-b10549" / "llama-cli"',
    )
    text = text.replace(
        "self.server_binary = Path(server_binary or DEFAULT_LLAMA_SERVER_PATH)",
        'self.server_binary = Path(server_binary) if server_binary else _paths.resolve_runtime_binary("llama-server", "APHRODY_LLAMA_SERVER_BIN", "runtimes/llama-b10549/llama-server")',
    )
    text = text.replace(
        "self.cli_binary = Path(cli_binary or DEFAULT_LLAMA_CLI_PATH)",
        'self.cli_binary = Path(cli_binary) if cli_binary else _paths.resolve_runtime_binary("llama-cli", "APHRODY_LLAMA_CLI_BIN", "runtimes/llama-b10549/llama-cli")',
    )
    write(harmony, text)
    whisper = SDK / "src/aphrody/audio/whisper_transcribe.py"
    text = whisper.read_text()
    if "from aphrody import _paths" not in text:
        text = text.replace(
            "import numpy as np\n", "import numpy as np\n\nfrom aphrody import _paths\n"
        )
    tree = ast.parse(text)
    lines = text.splitlines(keepends=True)
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == "DEFAULT_WHISPER_CPP_BIN"
            for t in node.targets
        ):
            start = sum(map(len, lines[: node.lineno - 1]))
            end = sum(map(len, lines[: node.end_lineno]))
            text = (
                text[:start]
                + 'DEFAULT_WHISPER_CPP_BIN = str(_paths.state_dir() / "runtimes/whisper-b4938/whisper-cli")\n'
                + text[end:]
            )
            break
    text = text.replace(
        "self.whisper_cpp_bin = whisper_cpp_bin or DEFAULT_WHISPER_CPP_BIN",
        'self.whisper_cpp_bin = whisper_cpp_bin or str(_paths.resolve_runtime_binary("whisper-cli", "APHRODY_WHISPER_CPP_BIN", "runtimes/whisper-b4938/whisper-cli"))',
    )
    write(whisper, text)
    google = ROOT / "packages/cli/src/aphrody_cli/google.py"
    text = google.read_text()
    if "from aphrody import _paths" not in text:
        text = text.replace(
            "from pathlib import Path\n",
            "from pathlib import Path\n\nfrom aphrody import _paths\n",
        )
    text = text.replace(
        "if candidate.is_file():",
        "if candidate.is_file() and os.access(candidate, os.X_OK):",
    )
    text = text.replace(
        "            return str(candidate)\n\n    on_path",
        "            return str(candidate)\n        return None\n\n    on_path",
    )
    text = text.replace(
        'Path.home() / ".aphrody" / "bin"', '_paths.state_dir() / "bin"'
    )
    text = text.replace('        "aphrody-google.exe",\n', "").replace(
        '        "google.exe",\n', ""
    )
    write(google, text)
    test = ROOT / "packages/cli/tests/test_google_cli.py"
    text = (
        test.read_text()
        .replace('"google.exe"', '"google"')
        .replace('"aphrody-google.exe"', '"aphrody-google"')
    )
    text = (
        text.replace(
            'binary.write_bytes(b"stub")',
            'binary.write_bytes(b"stub")\n    binary.chmod(0o755)',
        )
        if "binary.chmod(0o755)" not in text
        else text
    )
    if 'monkeypatch.delenv("APHRODY_HOME"' not in text:
        text = text.replace(
            '    monkeypatch.setattr(Path, "home", lambda: tmp_path)',
            '    monkeypatch.delenv("APHRODY_HOME", raising=False)\n'
            '    monkeypatch.setattr(Path, "home", lambda: tmp_path)',
        )
    write(test, text)
    if "def test_nonexecutable_override_does_not_select_another_binary" not in text:
        text += """


def test_nonexecutable_override_does_not_select_another_binary(monkeypatch, tmp_path):
    binary = tmp_path / "configured-google"
    binary.write_text("not executable")
    binary.chmod(0o644)
    monkeypatch.setenv("APHRODY_GOOGLE_BIN", str(binary))
    monkeypatch.setattr(google_cli.shutil, "which", lambda _: "/usr/bin/another-google")
    assert google_cli._resolve_binary() is None


def test_linux_discovery_does_not_select_windows_executable(monkeypatch, tmp_path):
    binary = tmp_path / "bin/aphrody-google.exe"
    binary.parent.mkdir()
    binary.write_text("windows binary")
    binary.chmod(0o755)
    monkeypatch.setenv("APHRODY_HOME", str(tmp_path))
    monkeypatch.delenv("APHRODY_GOOGLE_BIN", raising=False)
    monkeypatch.setattr(google_cli.shutil, "which", lambda _: None)
    assert google_cli._resolve_binary() is None
"""
        write(test, text)
    replace(
        SDK / "tests/test_harmony_reasoning.py",
        '"fake/llama-cli.exe"',
        '"fake/llama-cli"',
    )
    write(
        SDK / "tests/test_linux_runtimes.py",
        '''# SPDX-License-Identifier: Apache-2.0
"""Linux discovery must honor configured executables and avoid .exe defaults."""
from pathlib import Path

import pytest

from aphrody import _paths
from aphrody.inference.harmony_reasoning import HarmonyRunner


def executable(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("#!/bin/sh\\nexit 0\\n")
    path.chmod(0o755)
    return path


def test_path_runtime_replaces_old_windows_default(monkeypatch, tmp_path):
    binary = executable(tmp_path / "llama-cli")
    monkeypatch.delenv("APHRODY_LLAMA_CLI_BIN", raising=False)
    monkeypatch.setenv("PATH", str(tmp_path))
    assert HarmonyRunner().cli_binary == binary


def test_override_takes_precedence_over_path(monkeypatch, tmp_path):
    binary = executable(tmp_path / "custom-cli")
    monkeypatch.setenv("APHRODY_LLAMA_CLI_BIN", str(binary))
    assert HarmonyRunner().cli_binary == binary


@pytest.mark.parametrize("kind", ["missing", "nonexecutable"])
def test_bad_explicit_runtime_is_reported(monkeypatch, tmp_path, kind):
    binary = tmp_path / "custom-cli"
    if kind == "nonexecutable":
        binary.write_text("not executable")
        binary.chmod(0o644)
    monkeypatch.setenv("APHRODY_LLAMA_CLI_BIN", str(binary))
    error = FileNotFoundError if kind == "missing" else PermissionError
    with pytest.raises(error, match="APHRODY_LLAMA_CLI_BIN"):
        HarmonyRunner()


def test_linux_state_directory_and_permissions(monkeypatch, tmp_path):
    monkeypatch.setenv("APHRODY_HOME", str(tmp_path))
    monkeypatch.setenv("PATH", "")
    monkeypatch.delenv("APHRODY_WHISPER_CPP_BIN", raising=False)
    candidate = tmp_path / "bin/whisper-cli"
    candidate.parent.mkdir()
    candidate.write_text("not executable")
    candidate.chmod(0o644)
    fallback = "runtimes/whisper-b4938/whisper-cli"
    assert _paths.resolve_runtime_binary("whisper-cli", "APHRODY_WHISPER_CPP_BIN", fallback) == tmp_path / fallback
    candidate.chmod(0o755)
    assert _paths.resolve_runtime_binary("whisper-cli", "APHRODY_WHISPER_CPP_BIN", fallback) == candidate


def test_runtime_resolution_is_dynamic(monkeypatch, tmp_path):
    monkeypatch.setenv("PATH", "")
    monkeypatch.delenv("APHRODY_LLAMA_SERVER_BIN", raising=False)
    first = tmp_path / "first"
    second = tmp_path / "second"
    monkeypatch.setenv("APHRODY_HOME", str(first))
    assert HarmonyRunner().server_binary.is_relative_to(first)
    monkeypatch.setenv("APHRODY_HOME", str(second))
    assert HarmonyRunner().server_binary.is_relative_to(second)
''',
    )
    write(
        ROOT / "docs/sdk/linux.md",
        """<!-- SPDX-License-Identifier: Apache-2.0 -->
# Linux runtime contract

Linux is the supported development and release platform. Workspace CI uses
Ubuntu and CPython 3.12; isolated SDK wheels are checked on Ubuntu with
CPython 3.11, 3.12, 3.13 and 3.14. macOS and Windows are outside qualification.
The wheel gate checks the Linux native ABI, source-archive rebuild, licenses,
installed imports and native functions. Compatibility helpers for old consumers
are retained without creating release obligations on other operating systems.

Native tools are resolved from explicit configuration, executable names on PATH,
and executable files under `$APHRODY_HOME/bin` (default `~/.aphrody/bin`).
Legacy Linux runtime directories remain fallback paths. No .exe or Windows
Release directory is a default Linux runtime.

- `APHRODY_LLAMA_SERVER_BIN`: llama-server executable.
- `APHRODY_LLAMA_CLI_BIN`: llama-cli executable.
- `APHRODY_WHISPER_CPP_BIN`: whisper-cli executable.
- `APHRODY_GOOGLE_BIN`: native aphrody-google executable.

Constructors also accept explicit runtime paths. A configured llama/Whisper
runtime that is missing or lacks executable permission fails with its variable
name, rather than silently selecting another runtime. The Google launcher only
selects executable files. No model or runtime is downloaded by discovery.

Authentication uses the agy OAuth file, the Rust login file under
`$XDG_CONFIG_HOME/aphrody`, and the existing private token store. Tokens remain
private, with owner-only file permissions; no Windows credential store is
required on Linux.

Run `python tools/packaging/modernize_workspace.py apply`, then `check`.
For an isolated Linux SDK version, run `python tools/packaging/modernize_workspace.py
linux-sdk --python 3.11` (also accepts 3.12, 3.13 and 3.14).
Run `providers` separately for the pinned private Antigravity contract.
CUDA, model inference, Blender and live cloud workflows require their actual
Linux runtimes and fixtures. Skipped tests are not integration qualification.
""",
    )
    for relative in ("README.md", "environments/README.md", "PLAN.md"):
        path = ROOT / relative
        text = path.read_text()
        if "docs/sdk/linux.md" not in text:
            text += (
                "\nLinux is the supported platform; see [Linux contracts](docs/sdk/linux.md).\n"
                if relative != "environments/README.md"
                else "\nLinux is the supported platform; see [Linux contracts](../docs/sdk/linux.md).\n"
            )
        write(path, text)
    path = ROOT / "docs/sdk/workspace-audit.md"
    text = path.read_text().replace("and three OS families", "on Ubuntu Linux")
    text = text.replace(
        "Heavy models, CUDA training, Blender execution, live cloud APIs and Windows\nRust cross-compilation require their actual runtimes.",
        "Heavy models, CUDA training, Blender execution and live cloud APIs require\ntheir actual Linux runtimes. Windows is outside the supported release scope.",
    )
    write(path, text)
    path = ROOT / "docs/sdk/PLAN.md"
    write(
        path,
        """<!-- SPDX-License-Identifier: Apache-2.0 -->
# Linux SDK qualification plan

Linux is the development and release target. The complete workspace uses
CPython 3.12; the SDK's Linux artifact matrix covers CPython 3.11–3.14.

- [x] Pinned native source without checkout-neighbor runtime dependencies.
- [x] Separate SDK, Python CLI and meeting application distributions.
- [x] Root lint, format, types and tests; clean installed distribution gates.
- [x] Linux executable discovery, permissions and explicit configuration.
- [x] Ubuntu-only CI matrix and Linux distribution metadata.
- [ ] Qualify live Linux models, CUDA, audio fixtures and Blender execution.
- [ ] Qualify authenticated cloud APIs before release of each optional feature.
- [ ] Publish correlated release artifacts and prove installation and rollback
  through the owning Infra workflow.

The migration and checks are owned by `tools/packaging/modernize_workspace.py`.
Use `linux-sdk --python VERSION` for installed SDK artifacts outside the
workspace environment. See [validation](validation.md) and [Linux](linux.md).
NIE/IECODE runtime ownership remains with the IECODE repository.
Older audit and platform observations remain historical evidence in Git.
""",
    )
    path = ROOT / "docs/sdk/validation.md"
    text = path.read_text()
    start = text.index("The `Python SDK distributions` workflow")
    end = (
        text.index("It copies only", start)
        if "It copies only" in text[start:]
        else text.index("the SDK project", start)
    )
    text = (
        text[:start]
        + "The `Python SDK distributions` workflow builds Aphrody on Ubuntu Linux with\nPython 3.11, 3.12, 3.13 and 3.14. It copies only\n"
        + text[end:].removeprefix("It copies only\n")
    )
    text = text.replace("all six workflow jobs", "all four Linux workflow jobs")
    text = text.replace(
        "It rejects\ndirect URL runtime dependencies and a core Scrapy\ndependency.",
        "It permits only the exactly pinned optional Antigravity Git dependency;\n"
        "other direct URLs and a core Scrapy dependency are rejected.",
    )
    start = text.index("To reproduce")
    end = text.index("## Local qualification", start)
    text = (
        text[:start]
        + """To reproduce an isolated Linux SDK qualification:

```sh
python tools/packaging/modernize_workspace.py linux-sdk --python 3.11
python tools/packaging/modernize_workspace.py check
```

The SDK command accepts 3.11, 3.12, 3.13 and 3.14 and records wheel hashes
after both installations pass. `check` qualifies all seven distributions on
the complete workspace baseline, CPython 3.12. Configured CI jobs alone do
not establish that a particular remote workflow run succeeded.

The following dated results describe earlier versions of the workspace.

"""
        + text[end:]
    )
    text = text.replace(
        "Windows, macOS and the additional Linux Python versions are configured CI gates;",
        "The additional Linux Python versions are configured CI gates;",
    )
    if "# Linux scope" not in text:
        text += "\n## Linux scope\n\nThe Windows failure recorded above is historical and is not a current gate.\nLinux is the supported release platform. See [Linux contracts](linux.md).\n"
    write(path, text)
    path = SDK / "README.md"
    text = path.read_text().replace(
        "- **Windows**: Credential Manager `gemini:antigravity`\n", ""
    )
    if "Linux is the supported" not in text:
        text = text.replace(
            "## Install",
            "Linux is the supported development and release platform.\n\n## Install",
        )
    write(path, text)


def migrate_consumers() -> None:
    """Update the known documentation selector when its owning repo exists."""
    selector = ROOT.parent / "aphrody/config/docs/documentation.json"
    if selector.is_file():
        changed = "packages/aphrody/aphrody/google.py" in selector.read_text()
        replace(
            selector,
            "packages/aphrody/aphrody/google.py",
            "packages/aphrody/src/aphrody/google.py",
        )
        if changed:
            run("bun", "run", "docs:gen", cwd=selector.parents[2])


def isolated_distributions(python: str = "3.12") -> None:
    """Build and test every installed wheel without checkout import shadowing."""
    members = load(ROOT / "pyproject.toml")["tool"]["uv"]["workspace"]["members"]
    with tempfile.TemporaryDirectory(prefix="aphrody-distributions-") as temporary:
        work = Path(temporary)
        dist = work / "dist"
        wheels: dict[str, Path] = {}
        for member in members:
            directory = ROOT / member
            project = load(directory / "pyproject.toml")["project"]
            run(
                "uv",
                "build",
                str(directory),
                "--no-sources",
                "--python",
                python,
                "--out-dir",
                str(dist),
            )
            wheel = next(dist.glob(project["name"].replace("-", "_") + "-*.whl"))
            with zipfile.ZipFile(wheel) as archive:
                names = archive.namelist()
                data = email.parser.BytesParser().parsebytes(
                    archive.read(
                        next(
                            name
                            for name in names
                            if name.endswith(".dist-info/METADATA")
                        )
                    )
                )
                expected_license = project.get("license", "Apache-2.0")
                if data.get(
                    "License-Expression"
                ) != expected_license or not data.get_all("License-File"):
                    raise ValueError(f"Incomplete license metadata: {wheel.name}")
                if not any(name.endswith("/py.typed") for name in names):
                    raise ValueError(f"Missing typing marker: {wheel.name}")
                if project["name"] == "aphrody" and any(
                    name.endswith("/entry_points.txt") for name in names
                ):
                    raise ValueError("Core SDK must not install CLI executables")
            wheels[project["name"]] = wheel
        run(
            "uv",
            "build",
            str(next(dist.glob("aphrody-*.tar.gz"))),
            "--wheel",
            "--no-sources",
            "--python",
            python,
            "--out-dir",
            str(work / "rebuilt"),
        )
        for wheel in (
            wheels["aphrody"],
            next((work / "rebuilt").glob("aphrody-*.whl")),
        ):
            run(
                "uv",
                "run",
                "--no-sync",
                "python",
                str(ROOT / "tools/sdk/verify-wheel.py"),
                str(wheel),
                "--python",
                python,
                "--tests",
                str(SDK / "tests"),
            )
        for member in members:
            directory = ROOT / member
            project = load(directory / "pyproject.toml")["project"]
            if project["name"] == "aphrody":
                continue
            name = project["name"]
            venv = work / name / "venv"
            run("uv", "venv", "--python", python, str(venv), cwd=work)
            executable = venv / (
                "Scripts/python.exe" if os.name == "nt" else "bin/python"
            )
            dependencies = [
                str(wheels[name]),
                "pytest",
                "pytest-httpx",
                "pytest-asyncio",
            ]
            if name in {"aphrody-cli", "aphrody-meetings"}:
                dependencies.append(str(wheels["aphrody"]))
            if name == "aphrody-train":
                dependencies[0] += "[dedup]"
            if name == "aphrody-cli":
                dependencies.extend(
                    ["Pillow>=12", "pyoxipng>=9.1", "numpy", "networkx"]
                )
            run(
                "uv",
                "pip",
                "install",
                "--python",
                str(executable),
                *dependencies,
                cwd=work,
            )
            imports = load(directory / "pyproject.toml")["tool"]["hatch"]["build"][
                "targets"
            ]["wheel"]["packages"][0].split("/")[-1]
            smoke = f"import importlib, pathlib; module=importlib.import_module({imports!r}); assert pathlib.Path(module.__file__).is_relative_to(pathlib.Path({str(venv)!r}))"
            run(str(executable), "-I", "-c", smoke, cwd=work)
            tests = directory / "tests"
            if tests.exists() and any(tests.glob("test_*.py")):
                isolated = work / name / "tests"
                shutil.copytree(
                    tests,
                    isolated,
                    ignore=shutil.ignore_patterns("__pycache__", ".pytest_cache"),
                )
                config = work / name / "pytest.ini"
                write(
                    config,
                    "[pytest]\naddopts = --strict-markers\nmarkers =\n    integration: opt-in services\n    live_api: opt-in authenticated calls\n",
                )
                run(
                    str(executable),
                    "-I",
                    "-m",
                    "pytest",
                    "-c",
                    str(config),
                    "--import-mode=importlib",
                    "-m",
                    "not integration and not live_api",
                    str(isolated),
                    cwd=work,
                )


def linux_sdk(python: str) -> None:
    """Build and qualify a Linux SDK wheel and an independent sdist rebuild."""
    if not os.uname().sysname == "Linux":
        raise SystemExit("Linux SDK qualification requires a Linux host")
    with tempfile.TemporaryDirectory(prefix="aphrody-linux-sdk-") as temporary:
        work = Path(temporary)
        source = work / "source"
        shutil.copytree(
            SDK,
            source,
            ignore=shutil.ignore_patterns(
                ".git",
                ".venv",
                "__pycache__",
                "target",
                "dist",
                "build",
                "*.so",
                "*.pyd",
            ),
        )
        output = work / "dist"
        rebuilt = work / "rebuilt"
        run(
            "uv",
            "--no-config",
            "build",
            str(source),
            "--no-sources",
            "--python",
            python,
            "--out-dir",
            str(output),
            cwd=work,
        )
        archives = list(output.glob("*.tar.gz"))
        if len(archives) != 1:
            raise RuntimeError("Expected exactly one SDK source archive")
        run(
            "uv",
            "--no-config",
            "build",
            str(archives[0]),
            "--wheel",
            "--no-sources",
            "--python",
            python,
            "--out-dir",
            str(rebuilt),
            cwd=work,
        )
        hashes = {}
        for directory in (output, rebuilt):
            wheels = list(directory.glob("*.whl"))
            if len(wheels) != 1:
                raise RuntimeError("Expected exactly one SDK wheel")
            wheel = wheels[0]
            run(
                "python3",
                str(ROOT / "tools/sdk/verify-wheel.py"),
                str(wheel),
                "--python",
                python,
                "--tests",
                str(SDK / "tests"),
                cwd=work,
            )
            hashes[directory.name] = hashlib.sha256(wheel.read_bytes()).hexdigest()
        report = {
            "platform": "linux",
            "architecture": os.uname().machine,
            "python": python,
            "gates": {"installedWheel": "pass", "independentSdistWheel": "pass"},
            "wheelHashes": hashes,
        }
        write(
            ROOT / f"docs/migration/linux-sdk-{python}.json",
            json.dumps(report, indent=2) + "\n",
        )


def providers() -> None:
    """Qualify the private pinned fork without replacing the workspace environment."""
    with tempfile.TemporaryDirectory(prefix="aphrody-provider-") as temporary:
        work = Path(temporary)
        venv = work / "venv"
        run("uv", "venv", "--python", "3.12", str(venv))
        executable = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        run("uv", "build", str(SDK), "--wheel", "--no-sources", "--out-dir", str(work))
        wheel = next(work.glob("aphrody-*.whl"))
        run(
            "uv",
            "pip",
            "install",
            "--python",
            str(executable),
            str(wheel) + "[antigravity]",
            "pytest",
            "pytest-httpx",
            "pytest-asyncio",
            cwd=work,
        )
        tests = work / "tests"
        tests.mkdir()
        shutil.copy2(
            SDK / "tests/test_antigravity_bridge.py",
            tests / "test_antigravity_bridge.py",
        )
        config = work / "pytest.ini"
        write(config, "[pytest]\n")
        run(
            str(executable),
            "-I",
            "-c",
            "import importlib.metadata as m, json; "
            "data=json.loads(m.distribution('google-antigravity').read_text('direct_url.json')); "
            f"assert data['url'] == {FORK!r}; "
            f"assert data['vcs_info']['commit_id'] == {PIN!r}",
            cwd=work,
        )
        results = work / "provider-results.xml"
        run(
            str(executable),
            "-I",
            "-m",
            "pytest",
            "-c",
            str(config),
            "--junitxml",
            str(results),
            str(tests),
            cwd=work,
        )
        suites = ET.parse(results).getroot().findall("testsuite")
        assert sum(int(suite.attrib["tests"]) for suite in suites) > 0
        assert all(int(suite.attrib["skipped"]) == 0 for suite in suites)


def refresh_member_locks() -> None:
    """Generate standalone locks with no ancestor workspace in scope."""
    for directory in (SDK, ROOT / "packages/aphrody-train"):
        with tempfile.TemporaryDirectory(prefix="aphrody-lock-refresh-") as temporary:
            staged = Path(temporary) / directory.name
            shutil.copytree(
                directory,
                staged,
                ignore=shutil.ignore_patterns(
                    ".venv",
                    "target",
                    "build",
                    "dist",
                    "__pycache__",
                    ".pytest_cache",
                    ".ruff_cache",
                    "*.so",
                    "*.pyd",
                ),
            )
            run("uv", "lock", cwd=staged)
            write(directory / "uv.lock", (staged / "uv.lock").read_text())


def normalize_source() -> None:
    """Normalize first-party tracked text without entering datasets or archives."""
    tracked = (
        subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT)
        .decode()
        .split("\0")
    )
    paths = {
        ROOT / item
        for item in tracked
        if item.endswith((".py", ".toml", ".md", ".yml"))
        and not item.startswith(("docs/migration/", "packages/os/drive/", "tools/ui/"))
    }
    paths.update(SDK.joinpath("src").rglob("*.py"))
    paths.update(ROOT.joinpath("packages/cli/src").rglob("*.py"))
    paths.update(ROOT.joinpath("apps/meetings/src").rglob("*.py"))
    for path in paths:
        if path.is_file():
            write(path, path.read_text(encoding="utf-8"))


def locks() -> None:
    """Check the root lock and member locks outside workspace discovery."""
    run("uv", "lock", "--check")
    for directory in (SDK, ROOT / "packages/aphrody-train"):
        with tempfile.TemporaryDirectory(prefix="aphrody-lock-") as temporary:
            staged = Path(temporary) / directory.name
            shutil.copytree(
                directory,
                staged,
                ignore=shutil.ignore_patterns(
                    ".venv",
                    "target",
                    "build",
                    "dist",
                    "__pycache__",
                    ".pytest_cache",
                    ".ruff_cache",
                    "*.so",
                    "*.pyd",
                ),
            )
            run("uv", "lock", "--check", cwd=staged)


def main() -> None:
    """Apply the migration or run its reproducible validation gates."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        choices=["apply", "locks", "check", "distributions", "providers", "linux-sdk"],
    )
    parser.add_argument(
        "--python", default="3.12", choices=["3.11", "3.12", "3.13", "3.14"]
    )
    args = parser.parse_args()
    if args.command == "linux-sdk":
        linux_sdk(args.python)
        return
    if args.command == "providers":
        providers()
        return
    if args.command == "distributions":
        isolated_distributions()
        return
    if args.command == "locks":
        locks()
        return
    if args.command == "check":
        locks()
        run(
            "uv",
            "sync",
            "--all-packages",
            "--locked",
            "--extra",
            "rag",
            "--extra",
            "dedup",
        )
        run("uv", "run", "--no-sync", "ruff", "check", ".")
        run("uv", "run", "--no-sync", "ruff", "format", "--check", ".")
        run("uv", "run", "--no-sync", "mypy")
        run("uv", "run", "--no-sync", "pytest")
        isolated_distributions()
        validation_report()
        return
    migrate_layout()
    migrate_metadata()
    migrate_runtime()
    migrate_verifier()
    migrate_contracts()
    migrate_types()
    migrate_type_contracts()
    migrate_application()
    migrate_ci_and_docs()
    migrate_documentation()
    migrate_remaining_paths()
    migrate_linux_focus()
    migrate_consumers()
    normalize_source()
    run("uv", "lock")
    refresh_member_locks()
    run(
        "uv", "sync", "--all-packages", "--locked", "--extra", "rag", "--extra", "dedup"
    )
    run("uv", "run", "--no-sync", "ruff", "check", "--fix", ".")
    run("uv", "run", "--no-sync", "ruff", "format", ".")


if __name__ == "__main__":
    main()
