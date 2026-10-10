# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
"""Structured document OCR and extraction module for Granite Docling 258M.

This module provides high-fidelity document parsing (PDF and images) using IBM
Granite Docling 258M and Docling Core. It supports hardware-accelerated
inference (CUDA / ONNX Runtime CUDA, falling back to CPU), table extraction via
TableFormer / OTSL, LaTeX math, and output rendering to structured Markdown and JSON.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from aphrody._paths import state_dir

_logger = logging.getLogger(__name__)


# Default model checkpoints in ~/.aphrody/models
def _granite_model_dir() -> Path:
    return (
        state_dir()
        / "models"
        / "hf"
        / "ggml-org"
        / "granite-docling-258M-GGUF"
        / "684c1800c5fbd614e29b4d1a82177e6c122af1f3"
    )


DEFAULT_GRANITE_GGUF_DIR = _granite_model_dir()
DEFAULT_GRANITE_WEIGHTS = DEFAULT_GRANITE_GGUF_DIR / "granite-docling-258M-Q8_0.gguf"
DEFAULT_GRANITE_MMPROJ = (
    DEFAULT_GRANITE_GGUF_DIR / "mmproj-granite-docling-258M-f16.gguf"
)


# Default llama multimodal runner
def _runner_name() -> str:
    return "llama-mtmd-cli.exe" if sys.platform == "win32" else "llama-mtmd-cli"


def _default_runner_path() -> Path:
    return state_dir() / "runtimes" / "llama-b10549" / _runner_name()


DEFAULT_LLAMA_MTMD_CLI = _default_runner_path()


def resolve_runner(runner_bin: str | Path | None = None) -> Path:
    """Resolve explicit runner, environment override, managed runtime, then PATH.

    Explicit paths remain authoritative even when absent. Bare command names
    in explicit configuration may resolve through PATH.
    """
    configured = runner_bin or os.environ.get("APHRODY_LLAMA_MTMD_CLI")
    if configured:
        path = Path(configured).expanduser()
        if path.is_file():
            return path.resolve()
        if "/" not in str(configured) and "\\" not in str(configured):
            located = shutil.which(str(path))
            if located:
                return Path(located)
        return path
    managed = _default_runner_path()
    if managed.is_file():
        return managed.resolve()
    located = shutil.which(_runner_name())
    return Path(located) if located else managed


# Standard Docling instruction prompt
DEFAULT_DOCLING_PROMPT = "Convert this page to docling."


@dataclass
class DocumentBlock:
    """A semantic block decoded from DocTags / Docling."""

    tag: str
    text: str
    bbox: list[float] | None = None
    level: int | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert block to dictionary representation."""
        res: dict[str, Any] = {"tag": self.tag, "text": self.text}
        if self.bbox is not None:
            res["bbox"] = self.bbox
        if self.level is not None:
            res["level"] = self.level
        return res


@dataclass
class ExtractionPageResult:
    """Extraction outcome for one page."""

    page_index: int
    markdown: str
    raw_doctags: str
    blocks: list[DocumentBlock] = field(default_factory=list)
    has_text: bool = True
    tables_count: int = 0
    formulas_count: int = 0
    elapsed_ms: int = 0

    def to_dict(self) -> dict[str, Any]:
        """Convert page result to dictionary."""
        return {
            "page_index": self.page_index,
            "markdown": self.markdown,
            "raw_doctags": self.raw_doctags,
            "blocks": [b.to_dict() for b in self.blocks],
            "has_text": self.has_text,
            "tables_count": self.tables_count,
            "formulas_count": self.formulas_count,
            "elapsed_ms": self.elapsed_ms,
        }


@dataclass
class DoclingExtractionResult:
    """Complete document extraction result."""

    file_path: str
    pages: list[ExtractionPageResult]
    markdown: str
    json_data: dict[str, Any]
    device: str
    backend: str
    total_elapsed_ms: int

    def to_dict(self) -> dict[str, Any]:
        """Convert complete result to dictionary representation."""
        return {
            "file_path": self.file_path,
            "pages": [p.to_dict() for p in self.pages],
            "markdown": self.markdown,
            "json_data": self.json_data,
            "device": self.device,
            "backend": self.backend,
            "total_elapsed_ms": self.total_elapsed_ms,
        }


class DoclingExtractor:
    """Extractor using Granite Docling 258M and Docling Core.

    Provides multi-page PDF rendering, direct image OCR, TableFormer / OTSL
    parsing, LaTeX extraction, and JSON / Markdown serialization.
    """

    def __init__(
        self,
        weights_path: str | Path | None = None,
        mmproj_path: str | Path | None = None,
        runner_bin: str | Path | None = None,
        device: Literal["auto", "cuda", "cpu"] = "auto",
        max_tokens: int = 1024,
    ) -> None:
        model_dir = _granite_model_dir()
        self.weights_path = Path(
            weights_path or model_dir / DEFAULT_GRANITE_WEIGHTS.name
        ).expanduser()
        self.mmproj_path = Path(
            mmproj_path or model_dir / DEFAULT_GRANITE_MMPROJ.name
        ).expanduser()
        self.runner_bin = resolve_runner(runner_bin)
        self.max_tokens = max_tokens

        # Resolve acceleration device
        self.device = self._resolve_device(device)
        self.gpu_layers = 99 if self.device == "cuda" else 0

    def _resolve_device(self, requested: str) -> str:
        """Resolve execution provider: CUDA if available, fallback to CPU."""
        if requested == "cpu":
            return "cpu"
        if requested == "cuda":
            return "cuda"

        # Check torch CUDA
        try:
            import torch

            if torch.cuda.is_available():
                return "cuda"
        except Exception:
            pass

        # Check ONNX Runtime CUDA
        try:
            import onnxruntime as ort

            if "CUDAExecutionProvider" in ort.get_available_providers():
                return "cuda"
        except Exception:
            pass

        # Check nvidia-smi as fallback
        try:
            res = subprocess.run(
                ["nvidia-smi"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
                timeout=5,
            )
            if res.returncode == 0:
                return "cuda"
        except Exception:
            pass

        return "cpu"

    def verify_model_present(self) -> bool:
        """Verify that Granite Docling weights and mmproj are present on disk."""
        return self.weights_path.is_file() and self.mmproj_path.is_file()

    def verify_runtime_ready(self) -> bool:
        """Check model files and an executable runner without starting inference.

        This verifies local prerequisites, not GPU support or model compatibility.
        """
        return (
            self.verify_model_present()
            and self.runner_bin.is_file()
            and (sys.platform == "win32" or os.access(self.runner_bin, os.X_OK))
        )

    def extract_image(
        self,
        image_path: str | Path,
        page_index: int = 0,
    ) -> ExtractionPageResult:
        """Extract structured content from a single image."""
        start_time = time.perf_counter()
        image_path = Path(image_path)

        if not image_path.is_file():
            raise FileNotFoundError(f"Input image not found: {image_path}")
        if not self.verify_model_present():
            raise FileNotFoundError(
                f"Granite Docling model not found at {self.weights_path}"
            )
        if not self.runner_bin.is_file():
            raise FileNotFoundError(
                f"Multimodal runner binary not found at {self.runner_bin}"
            )
        if sys.platform != "win32" and not os.access(self.runner_bin, os.X_OK):
            raise PermissionError(
                f"Multimodal runner binary is not executable: {self.runner_bin}"
            )

        cmd = [
            str(self.runner_bin),
            "-m",
            str(self.weights_path),
            "--mmproj",
            str(self.mmproj_path),
            "--image",
            str(image_path),
            "-p",
            DEFAULT_DOCLING_PROMPT,
            "-ngl",
            str(self.gpu_layers),
            "-n",
            str(self.max_tokens),
            "--temp",
            "0",
            "--no-warmup",
        ]

        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=False,
        )

        if proc.returncode != 0:
            raise RuntimeError(
                f"Runner exited with code {proc.returncode}: {proc.stderr[:400]}"
            )

        raw_output = proc.stdout
        elapsed_ms = int((time.perf_counter() - start_time) * 1000)

        # Parse DocTags
        blocks = self.parse_doctags_blocks(raw_output)
        markdown = self.render_to_markdown(raw_output, blocks)

        tables_count = sum(1 for b in blocks if b.tag in ("table", "otsl"))
        formulas_count = sum(1 for b in blocks if b.tag == "formula")
        has_text = any(
            b.tag not in ("picture", "page_header", "page_footer") and b.text.strip()
            for b in blocks
        )

        return ExtractionPageResult(
            page_index=page_index,
            markdown=markdown,
            raw_doctags=raw_output,
            blocks=blocks,
            has_text=has_text,
            tables_count=tables_count,
            formulas_count=formulas_count,
            elapsed_ms=elapsed_ms,
        )

    def extract_document(
        self,
        document_path: str | Path,
    ) -> DoclingExtractionResult:
        """Extract structured content from PDF or Image document."""
        start_time = time.perf_counter()
        doc_path = Path(document_path)

        if not doc_path.exists():
            raise FileNotFoundError(f"Document not found: {doc_path}")

        suffix = doc_path.suffix.lower()
        pages: list[ExtractionPageResult] = []

        if suffix == ".pdf":
            # Multi-page PDF: rasterize pages to temporary images
            import tempfile

            try:
                import pypdfium2

                pdf = pypdfium2.PdfDocument(str(doc_path))
                try:
                    with tempfile.TemporaryDirectory(prefix="aphrody_ocr_") as tmp_dir:
                        for i, page in enumerate(pdf):
                            rendered = page.render(scale=2.0).to_pil()
                            page_img_path = Path(tmp_dir) / f"page_{i}.png"
                            rendered.save(page_img_path)
                            page_res = self.extract_image(page_img_path, page_index=i)
                            pages.append(page_res)
                finally:
                    pdf.close()
            except ImportError as exc:
                # pypdfium2 renders the PDF pages; without it (or Pillow) PDF
                # extraction is unavailable.
                raise RuntimeError(
                    "pypdfium2 and Pillow are required for PDF document extraction."
                ) from exc
        else:
            # Single image format
            page_res = self.extract_image(doc_path, page_index=0)
            pages.append(page_res)

        total_elapsed_ms = int((time.perf_counter() - start_time) * 1000)

        # Assemble full markdown
        doc_markdown = "\n\n---\n\n".join(
            p.markdown for p in pages if p.markdown.strip()
        )

        # Assemble Docling JSON representation
        json_data = self.build_docling_json(doc_path.name, pages)

        return DoclingExtractionResult(
            file_path=str(doc_path.resolve()),
            pages=pages,
            markdown=doc_markdown,
            json_data=json_data,
            device=self.device,
            backend="granite-docling-258m-gguf",
            total_elapsed_ms=total_elapsed_ms,
        )

    @classmethod
    def parse_doctags_blocks(cls, raw: str) -> list[DocumentBlock]:
        """Parse raw stdout containing <doctag> into semantic blocks."""
        blocks: list[DocumentBlock] = []

        # Find doctag content
        dt_start = raw.find("<doctag>")
        cursor = raw[dt_start:] if dt_start != -1 else raw

        while True:
            open_start = cursor.find("<")
            if open_start == -1:
                break

            after_open = cursor[open_start + 1 :]
            open_end = after_open.find(">")
            if open_end == -1:
                break

            tag = after_open[:open_end]
            body_start = open_start + 1 + open_end + 1

            # Skip wrapper, closing tags, and inline loc markers
            if (
                tag == "doctag"
                or tag.startswith("/")
                or tag.startswith("loc_")
                or tag in ("other", "page_break")
                or tag.startswith("|")
            ):
                cursor = cursor[body_start:]
                continue

            closing = f"</{tag}>"
            body = cursor[body_start:]
            end_pos = body.find(closing)

            if end_pos != -1:
                payload = body[:end_pos]
                next_pos = body_start + end_pos + len(closing)
                cursor = cursor[next_pos:]
            else:
                payload = body
                cursor = ""

            # Extract coordinates if present
            coords = [int(m) for m in re.findall(r"<loc_(\d+)>", payload)]
            bbox = None
            if len(coords) >= 4:
                # Quantized coordinates [0..500] or [0..1000]
                scale = 500.0 if max(coords[:4]) <= 500 else 1000.0
                bbox = [c / scale for c in coords[:4]]

            # Clean markers
            text_cleaned = cls.strip_markers_and_html(payload)

            # Heading level
            level = None
            if tag.startswith("section_header_level_"):
                try:
                    level = int(tag.split("_")[-1])
                except ValueError:
                    level = 1

            blocks.append(
                DocumentBlock(
                    tag=tag,
                    text=text_cleaned,
                    bbox=bbox,
                    level=level,
                )
            )

            if not cursor:
                break

        return blocks

    @classmethod
    def strip_markers_and_html(cls, payload: str) -> str:
        """Strip <loc_*>, <other> and control tokens, normalizing whitespace."""
        # Replace markers
        s = re.sub(r"<loc_\d+>", " ", payload)
        s = re.sub(r"<other>", " ", s)
        s = re.sub(r"<\|[^>]+\|>", " ", s)

        # Retain table and formula markup as text if desired, or flatten
        # Collapse whitespace
        lines = []
        for line in s.splitlines():
            line_str = " ".join(line.split())
            if line_str:
                lines.append(line_str)
        return "\n".join(lines).strip()

    @classmethod
    def render_to_markdown(cls, raw_output: str, blocks: list[DocumentBlock]) -> str:
        """Render parsed blocks or raw DocTags to high-fidelity Markdown."""
        # Check if docling_core is available for native load_from_doctags
        try:
            from docling_core.types.doc.doctags import DocTagsDocument
            from docling_core.types.doc.document import DoclingDocument

            dt_match = re.search(r"<doctag>.*?</doctag>", raw_output, re.DOTALL)
            if dt_match:
                dt_str = dt_match.group(0)
                doc_tags = DocTagsDocument.from_doctags_and_image_pairs([dt_str], None)
                doc = DoclingDocument.load_from_doctags(
                    doc_tags, document_name="extracted"
                )
                md = doc.export_to_markdown()
                if md and md.strip():
                    return md.strip()
        except Exception as exc:
            _logger.debug(f"docling_core native renderer fallback: {exc}")

        # Deterministic fallback renderer
        lines: list[str] = []
        for block in blocks:
            if block.tag in ("page_header", "page_footer", "picture"):
                continue

            text = block.text.strip()
            if not text:
                continue

            if block.level is not None:
                hashes = "#" * max(1, min(6, block.level))
                lines.append(f"{hashes} {text}\n")
            elif block.tag == "list_item":
                lines.append(f"- {text}")
            elif block.tag == "caption":
                lines.append(f"*{text}*\n")
            elif block.tag == "formula":
                lines.append(f"$${text}$$\n")
            elif block.tag in ("table", "otsl"):
                # Table rendering
                lines.append(f"{text}\n")
            else:
                lines.append(f"{text}\n")

        return "\n\n".join(lines).strip()

    @classmethod
    def build_docling_json(
        cls, doc_name: str, pages: list[ExtractionPageResult]
    ) -> dict[str, Any]:
        """Export extraction to Docling-compatible JSON schema."""
        try:
            from docling_core.types.doc.doctags import DocTagsDocument
            from docling_core.types.doc.document import DoclingDocument

            all_tokens = [p.raw_doctags for p in pages if p.raw_doctags]
            if all_tokens:
                doc_tags = DocTagsDocument.from_doctags_and_image_pairs(
                    all_tokens, None
                )
                doc = DoclingDocument.load_from_doctags(
                    doc_tags, document_name=doc_name
                )
                return doc.export_to_dict()
        except Exception as exc:
            _logger.debug(f"DoclingDocument JSON export fallback: {exc}")

        # Fallback structured JSON schema
        return {
            "schema_name": "DoclingDocumentFallback",
            "version": "1.0.0",
            "name": doc_name,
            "pages": [p.to_dict() for p in pages],
            "total_pages": len(pages),
        }
