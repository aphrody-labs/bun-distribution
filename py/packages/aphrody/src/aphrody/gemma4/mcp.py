# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors & Google DeepMind
"""Model Context Protocol (MCP) server tools and bridge for Gemma 4."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

from aphrody.gemma4.client import Gemma4Client
from aphrody.gemma4.models import list_models
from aphrody.gemma4.service import describe_model, sample_summary


def gemma4_list_models() -> str:
    """MCP tool: List all models in the DeepMind Gemma 4 family.

    Returns:
        JSON string describing models, parameter sizes, MoE configs, and multimodal capabilities.
    """
    models = list_models()
    return json.dumps(models, indent=2)


def gemma4_inspect(model_id: str = "gemma4-e2b") -> str:
    """MCP tool: Inspect the detailed architecture of a Gemma 4 model.

    Args:
        model_id: Identifier of the Gemma 4 model (e.g. 'gemma4-e2b', 'gemma4-26b-a4b').

    Returns:
        JSON string containing layer dimensions, MoE expert counts, attention patterns, and encoder configs.
    """
    try:
        return json.dumps(describe_model(model_id), indent=2)
    except ValueError as exc:
        return json.dumps({"error": str(exc)})


def gemma4_chat(
    prompt: str,
    model_id: str = "gemma4-e2b",
    backend: str = "local",
    temperature: float = 0.7,
) -> str:
    """MCP tool: Send a chat prompt to a Gemma 4 model.

    Args:
        prompt: User input message.
        model_id: Gemma 4 variant ('gemma4-e2b', 'gemma4-e4b', 'gemma4-26b-a4b', 'gemma4-31b').
        backend: Execution backend ('local', 'gemini_web', 'antigravity').
        temperature: Sampling temperature.

    Returns:
        The generated assistant response text.
    """
    client = Gemma4Client(model=model_id, backend=backend)
    return client.chat(prompt, temperature=temperature)


def gemma4_multimodal_sample(
    prompt: str,
    model_id: str = "gemma4-e2b",
    image_count: int = 0,
    audio_seconds: float = 0.0,
) -> str:
    """MCP tool: Generate from Gemma 4 with multimodal tokens accounting.

    Args:
        prompt: Instruction or question.
        model_id: Target model identifier.
        image_count: Number of images provided in context.
        audio_seconds: Duration of audio in seconds.

    Returns:
        JSON representation of generated tokens and latency.
    """
    return json.dumps(
        sample_summary(prompt, model_id, image_count, audio_seconds), indent=2
    )


class Gemma4McpManager:
    """Registers and bridges Gemma 4 tools for any MCP server."""

    def __init__(self):
        self._tools: dict[str, tuple[Callable[..., Any], str, dict[str, Any]]] = {}
        self._register_defaults()

    def _register_defaults(self):
        self._tools["gemma4_list_models"] = (
            gemma4_list_models,
            "List all models in the DeepMind Gemma 4 family",
            {"type": "object", "properties": {}},
        )
        self._tools["gemma4_inspect"] = (
            gemma4_inspect,
            "Inspect the detailed architecture and MoE routing of a Gemma 4 model",
            {"type": "object", "properties": {"model_id": {"type": "string"}}},
        )
        self._tools["gemma4_chat"] = (
            gemma4_chat,
            "Execute a chat turn with a Gemma 4 model",
            {
                "type": "object",
                "properties": {
                    "prompt": {"type": "string"},
                    "model_id": {"type": "string"},
                    "backend": {"type": "string"},
                    "temperature": {"type": "number"},
                },
                "required": ["prompt"],
            },
        )
        self._tools["gemma4_multimodal_sample"] = (
            gemma4_multimodal_sample,
            "Generate text via the configured provider; nonzero media counts require real payloads",
            {
                "type": "object",
                "properties": {
                    "prompt": {"type": "string"},
                    "model_id": {"type": "string"},
                    "image_count": {"type": "integer"},
                    "audio_seconds": {"type": "number"},
                },
                "required": ["prompt"],
            },
        )

    def list_tools(self) -> list[dict[str, Any]]:
        """Return list of MCP tool definitions."""
        return [
            {
                "name": name,
                "description": desc,
                "inputSchema": schema,
            }
            for name, (_, desc, schema) in self._tools.items()
        ]

    def call_tool(self, name: str, arguments: dict[str, Any]) -> str:
        """Call an MCP tool by name."""
        if name not in self._tools:
            raise ValueError(f"Unknown Gemma 4 tool: {name}")
        fn, _, _ = self._tools[name]
        return fn(**arguments)


def register_gemma4_tools(server: Any = None) -> list[Callable[..., Any]]:
    """Register Gemma 4 tools with an MCP server or return list of tool functions.

    Args:
        server: Optional FastMCP or MCP server instance with a `.tool()` decorator/method.

    Returns:
        List of callable tool functions.
    """
    tools = [entry[0] for entry in Gemma4McpManager()._tools.values()]
    if server is not None:
        for tool_fn in tools:
            if hasattr(server, "tool") and callable(server.tool):
                server.tool()(tool_fn)
            elif hasattr(server, "add_tool") and callable(server.add_tool):
                server.add_tool(tool_fn)
    return tools
