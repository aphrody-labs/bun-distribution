# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
"""Authenticated Google Docs client and rich document builder."""

from __future__ import annotations

import os
import subprocess
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import httpx

from aphrody.auth import credentials
from aphrody.errors import AphrodyError, ApiError


def resolve_access_token() -> str:
    """Resolve a valid Google access token with Drive/Docs capabilities.

    Order of resolution:
    1. GOOGLE_DRIVE_ACCESS_TOKEN or GOOGLE_ACCESS_TOKEN environment variable.
    2. gcloud auth print-access-token (when logged in with gcloud).
    3. aphrody.auth.credentials.access_token() fallback.
    """
    env_token = os.environ.get("GOOGLE_DRIVE_ACCESS_TOKEN") or os.environ.get(
        "GOOGLE_ACCESS_TOKEN"
    )
    if env_token:
        return env_token.strip()

    try:
        res = subprocess.run(
            "gcloud auth print-access-token",
            shell=True,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        if res.returncode == 0 and res.stdout.strip():
            lines = res.stdout.strip().splitlines()
            candidate = lines[-1].strip()
            if candidate.startswith("ya29."):
                return candidate
    except Exception:
        pass

    return credentials.access_token()


class GoogleDocBuilder:
    """Builder for generating formatted Google Docs content with zero offset drift."""

    def __init__(self, title: str | None = None) -> None:
        """Initialize a new GoogleDocBuilder with optional title."""
        self.title = title
        self._text_parts: list[str] = []
        self._styles: list[dict[str, Any]] = []
        self._current_index = 1  # Google Docs starts at index 1

        if title:
            self.add_title(title)

    def add_title(self, text: str) -> GoogleDocBuilder:
        """Add a formatted Title paragraph to the document."""
        clean = text.strip() + "\n"
        start = self._current_index
        end = start + len(clean)
        self._text_parts.append(clean)
        self._styles.append(
            {
                "type": "paragraph_style",
                "start": start,
                "end": end,
                "style": "TITLE",
            }
        )
        self._styles.append(
            {
                "type": "text_style",
                "start": start,
                "end": end - 1,
                "bold": True,
                "color": (0.08, 0.23, 0.45),  # Navy Blue
            }
        )
        self._current_index = end
        return self

    def add_heading(self, text: str, level: int = 1) -> GoogleDocBuilder:
        """Add a heading (level 1-3) to the document."""
        clean = text.strip() + "\n"
        start = self._current_index
        end = start + len(clean)
        self._text_parts.append(clean)

        style_name = f"HEADING_{level}" if 1 <= level <= 3 else "HEADING_1"
        self._styles.append(
            {
                "type": "paragraph_style",
                "start": start,
                "end": end,
                "style": style_name,
            }
        )

        color = (0.12, 0.35, 0.65) if level == 1 else (0.2, 0.2, 0.2)
        self._styles.append(
            {
                "type": "text_style",
                "start": start,
                "end": end - 1,
                "bold": True,
                "color": color,
            }
        )
        self._current_index = end
        return self

    def add_paragraph(
        self,
        text: str,
        *,
        bold: bool = False,
        italic: bool = False,
        color: tuple[float, float, float] | None = None,
    ) -> GoogleDocBuilder:
        """Add a normal text paragraph with optional styling."""
        clean = text.strip() + "\n\n"
        start = self._current_index
        end = start + len(clean)
        self._text_parts.append(clean)
        self._styles.append(
            {
                "type": "paragraph_style",
                "start": start,
                "end": end,
                "style": "NORMAL_TEXT",
            }
        )
        if bold or italic or color:
            self._styles.append(
                {
                    "type": "text_style",
                    "start": start,
                    "end": end - 2,
                    "bold": bold,
                    "italic": italic,
                    "color": color,
                }
            )
        self._current_index = end
        return self

    def add_bullet(
        self, text: str, *, bold_prefix: str | None = None
    ) -> GoogleDocBuilder:
        """Add a bullet point list item with optional bold prefix."""
        if bold_prefix:
            line = f"{bold_prefix} {text.strip()}\n"
        else:
            line = text.strip() + "\n"

        start = self._current_index
        end = start + len(line)
        self._text_parts.append(line)

        self._styles.append(
            {
                "type": "bullet",
                "start": start,
                "end": end,
            }
        )
        if bold_prefix:
            self._styles.append(
                {
                    "type": "text_style",
                    "start": start,
                    "end": start + len(bold_prefix),
                    "bold": True,
                }
            )
        self._current_index = end
        return self

    def add_callout(self, text: str, *, label: str = "SYNTHÈSE") -> GoogleDocBuilder:
        """Add an emphasized callout block with colored label."""
        block = f"[{label}] {text.strip()}\n\n"
        start = self._current_index
        end = start + len(block)
        self._text_parts.append(block)

        self._styles.append(
            {
                "type": "paragraph_style",
                "start": start,
                "end": end,
                "style": "NORMAL_TEXT",
            }
        )
        self._styles.append(
            {
                "type": "text_style",
                "start": start,
                "end": start + len(label) + 2,
                "bold": True,
                "color": (0.75, 0.22, 0.17),  # Dark Red/Coral
            }
        )
        self._current_index = end
        return self

    def build_requests(self) -> list[dict[str, Any]]:
        """Construct the complete list of Google Docs API batchUpdate requests."""
        full_text = "".join(self._text_parts)
        if not full_text:
            return []

        requests: list[dict[str, Any]] = [
            {
                "insertText": {
                    "location": {"index": 1},
                    "text": full_text,
                }
            }
        ]

        for item in self._styles:
            kind = item["type"]
            start = item["start"]
            end = item["end"]

            if kind == "paragraph_style":
                requests.append(
                    {
                        "updateParagraphStyle": {
                            "range": {"startIndex": start, "endIndex": end},
                            "paragraphStyle": {"namedStyleType": item["style"]},
                            "fields": "namedStyleType",
                        }
                    }
                )
            elif kind == "text_style":
                text_style: dict[str, Any] = {}
                fields: list[str] = []
                if item.get("bold"):
                    text_style["bold"] = True
                    fields.append("bold")
                if item.get("italic"):
                    text_style["italic"] = True
                    fields.append("italic")
                if item.get("color"):
                    r, g, b = item["color"]
                    text_style["foregroundColor"] = {
                        "color": {"rgbColor": {"red": r, "green": g, "blue": b}}
                    }
                    fields.append("foregroundColor")

                if fields:
                    requests.append(
                        {
                            "updateTextStyle": {
                                "range": {"startIndex": start, "endIndex": end},
                                "textStyle": text_style,
                                "fields": ",".join(fields),
                            }
                        }
                    )
            elif kind == "bullet":
                requests.append(
                    {
                        "createParagraphBullets": {
                            "range": {"startIndex": start, "endIndex": end},
                            "bulletPreset": "BULLET_DISC_CIRCLE_SQUARE",
                        }
                    }
                )

        return requests


class AuthenticatedDocsClient:
    """Client wrapper for Google Docs operations using OAuth tokens."""

    def __init__(
        self,
        token_provider: Callable[[], str] | None = None,
        http: httpx.Client | None = None,
    ) -> None:
        self._token_provider = token_provider or resolve_access_token
        if http is None:
            import httpx

            self._http = httpx.Client(timeout=60.0)
        else:
            self._http = http
        self._owns_http = http is None
        self._closed = False

    def close(self) -> None:
        """Close the underlying HTTP client if owned by this instance."""
        if self._closed:
            return
        self._closed = True
        if self._owns_http:
            self._http.close()

    def __enter__(self) -> AuthenticatedDocsClient:
        self._ensure_open()
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def _ensure_open(self) -> None:
        if self._closed:
            raise AphrodyError("AuthenticatedDocsClient is closed")

    def _headers(self) -> dict[str, str]:
        self._ensure_open()
        token = self._token_provider()
        return {"Authorization": f"Bearer {token}"}

    def _request(
        self,
        method: str,
        url: str,
        *,
        json_data: Any = None,
        params: dict[str, Any] | None = None,
    ) -> httpx.Response:
        req_headers = self._headers()
        response = self._http.request(
            method,
            url,
            json=json_data,
            params=params,
            headers=req_headers,
        )
        if not response.is_success:
            raise ApiError(response.status_code, response.text, url=url)
        return response

    def create_document(self, title: str) -> dict[str, Any]:
        """Create a new blank Google Document and return its metadata."""
        url = "https://docs.googleapis.com/v1/documents"
        res = self._request("POST", url, json_data={"title": title})
        return res.json()

    def get_document(self, document_id: str) -> dict[str, Any]:
        """Retrieve the document structure and content."""
        url = f"https://docs.googleapis.com/v1/documents/{document_id}"
        res = self._request("GET", url)
        return res.json()

    def batch_update(
        self, document_id: str, requests: list[dict[str, Any]]
    ) -> dict[str, Any]:
        """Execute a batch of update operations on the Google Document."""
        self._ensure_open()
        if not requests:
            return {}
        url = f"https://docs.googleapis.com/v1/documents/{document_id}:batchUpdate"
        res = self._request("POST", url, json_data={"requests": requests})
        return res.json()

    def apply_builder(
        self, document_id: str, builder: GoogleDocBuilder
    ) -> dict[str, Any]:
        """Apply all text and formatting from a GoogleDocBuilder to a document."""
        requests = builder.build_requests()
        return self.batch_update(document_id, requests)
