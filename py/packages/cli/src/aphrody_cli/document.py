# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
"""Document OCR and parsing commands for the aphrody CLI."""

from __future__ import annotations

import json
from pathlib import Path

from aphrody_cli.utils import _emit


class DocumentCommands:
    """``aphrody doc <action>`` — high-fidelity document OCR & extraction."""

    def ocr(
        self,
        path: str,
        format: str = "markdown",
        out: str | None = None,
        device: str = "auto",
        max_tokens: int = 1024,
    ) -> None:
        """Extract structured Markdown and JSON from PDF or image using Granite Docling 258M.

        Args:
            path: Path to PDF or image file.
            format: Output format ('markdown', 'json', or 'both').
            out: Optional destination file path.
            device: Compute device ('auto', 'cuda', 'cpu').
            max_tokens: Token budget per page.
        """
        from aphrody.document.docling_extractor import DoclingExtractor

        extractor = DoclingExtractor(
            device=device,  # type: ignore[arg-type]
            max_tokens=max_tokens,
        )
        res = extractor.extract_document(path)

        if out:
            out_file = Path(out)
            out_file.parent.mkdir(parents=True, exist_ok=True)
            if format == "json":
                out_file.write_text(
                    json.dumps(res.to_dict(), indent=2, ensure_ascii=False),
                    encoding="utf-8",
                )
            elif format == "markdown":
                out_file.write_text(res.markdown, encoding="utf-8")
            else:
                out_file.write_text(
                    f"--- MARKDOWN ---\n{res.markdown}\n\n--- JSON ---\n"
                    + json.dumps(res.to_dict(), indent=2, ensure_ascii=False),
                    encoding="utf-8",
                )
            _emit(
                {
                    "action": "document_ocr",
                    "file_path": res.file_path,
                    "pages": len(res.pages),
                    "saved_to": str(out_file),
                    "device": res.device,
                    "elapsed_ms": res.total_elapsed_ms,
                }
            )
        elif format == "json":
            _emit(res.to_dict())
        elif format == "markdown":
            print(res.markdown)
        else:
            _emit(
                {
                    "markdown": res.markdown,
                    "metadata": res.to_dict(),
                }
            )
