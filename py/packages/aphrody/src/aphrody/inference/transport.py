# SPDX-License-Identifier: Apache-2.0
"""Shared HTTP and bounded SSE transport for compatible inference providers."""

from collections.abc import Iterator
from typing import Any

import httpx


class CompletionTransport:
    def __init__(self, base_url: str, api_key: str, timeout: float):
        self.url = base_url.rstrip("/") + "/chat/completions"
        self.headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        }
        self.timeout = timeout

    def complete(self, payload: dict[str, Any]) -> dict[str, Any]:
        with httpx.Client(timeout=self.timeout) as client:
            response = client.post(self.url, json=payload, headers=self.headers)
            response.raise_for_status()
            data = response.json()
        if not isinstance(data, dict):
            raise ValueError("Invalid inference provider response")
        return data

    def stream(self, payload: dict[str, Any]) -> Iterator[str]:
        """Yield provider text deltas; close the connection on consumer close/error."""
        import json

        terminal = False
        with (
            httpx.Client(timeout=self.timeout) as client,
            client.stream(
                "POST", self.url, json={**payload, "stream": True}, headers=self.headers
            ) as response,
        ):
            response.raise_for_status()
            for event in _events(response):
                if event.strip() == "[DONE]":
                    return
                data = json.loads(event)
                if not isinstance(data, dict) or data.get("error"):
                    raise ValueError("Invalid inference stream response")
                choices = data.get("choices")
                if choices == [] and data.get("usage"):
                    continue
                if (
                    not isinstance(choices, list)
                    or not choices
                    or not isinstance(choices[0], dict)
                ):
                    raise ValueError("Inference stream has no choices")
                choice = choices[0]
                delta = choice.get("delta")
                if not isinstance(delta, dict):
                    raise ValueError("Invalid inference stream delta")
                content = delta.get("content")
                if content is not None:
                    if not isinstance(content, str):
                        raise ValueError("Invalid inference stream text")
                    if content:
                        yield content
                if isinstance(choice.get("finish_reason"), str):
                    terminal = True
        if not terminal:
            raise ValueError("Inference stream ended without a completion marker")


def _events(response: httpx.Response) -> Iterator[str]:
    """Parse SSE data fields, bounded per event and pending line (one MiB)."""
    pending = ""
    fields: list[str] = []
    size = 0
    for chunk in response.iter_text(chunk_size=None):
        pending += chunk
        while "\n" in pending:
            line, pending = pending.split("\n", 1)
            line = line.removesuffix("\r")
            if len(line) > 1_048_576:
                raise ValueError("Inference SSE line exceeds the text budget")
            if not line:
                if fields:
                    yield "\n".join(fields)
                    fields, size = [], 0
            elif line.startswith("data:"):
                value = line[5:].removeprefix(" ")
                size += len(value) + 1
                if size > 1_048_576:
                    raise ValueError("Inference SSE event exceeds the text budget")
                fields.append(value)
        if len(pending) > 1_048_576:
            raise ValueError("Inference SSE line exceeds the text budget")
    if pending or fields:
        raise ValueError("Truncated inference SSE event")
