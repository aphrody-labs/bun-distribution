# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors & Google DeepMind
"""Tests for Gemma 4 MCP server tools and integration."""

from __future__ import annotations

import json

import pytest

from aphrody.gemma4 import (
    Gemma4McpManager,
    register_gemma4_tools,
)
from aphrody.gemma4.mcp import (
    gemma4_chat,
    gemma4_inspect,
    gemma4_list_models,
    gemma4_multimodal_sample,
)


def test_mcp_manager_list_tools() -> None:
    """Verify tool registration and schema exposure in Gemma4McpManager."""
    mgr = Gemma4McpManager()
    tools = mgr.list_tools()
    tool_names = [t["name"] for t in tools]
    assert "gemma4_list_models" in tool_names
    assert "gemma4_inspect" in tool_names
    assert "gemma4_chat" in tool_names
    assert "gemma4_multimodal_sample" in tool_names


def test_mcp_list_models_tool() -> None:
    """Verify gemma4_list_models returns valid JSON with all 4 models."""
    res_str = gemma4_list_models()
    models = json.loads(res_str)
    assert len(models) == 4
    names = [m["name"] for m in models]
    assert "gemma4-e2b" in names
    assert "gemma4-26b-a4b" in names


def test_mcp_inspect_tool() -> None:
    """Verify gemma4_inspect returns detailed JSON specifications."""
    res_str = gemma4_inspect("gemma4-26b-a4b")
    spec = json.loads(res_str)
    assert spec["name"] == "gemma4-26b-a4b"
    assert spec["enable_moe"] is True
    assert spec["num_experts"] == 128
    assert spec["top_k_experts"] == 8

    # Unknown model handling
    err_str = gemma4_inspect("invalid-model")
    err_data = json.loads(err_str)
    assert "error" in err_data


def test_mcp_chat_tool_local(native_provider) -> None:
    """Verify gemma4_chat executes through local sampler."""
    reply = gemma4_chat("Hello from test", model_id="gemma4-e2b", backend="local")
    assert reply == "42"
    assert (
        native_provider["requests"][0][1]["messages"][-1]["content"]
        == "Hello from test"
    )


def test_mcp_multimodal_sample_tool(native_provider) -> None:
    data = json.loads(gemma4_multimodal_sample("Question"))
    assert data["model"] == "gemma4-e2b"
    assert data["token_count"] == 2 and data["usage_source"] == "provider"
    with pytest.raises(NotImplementedError, match="payloads"):
        gemma4_multimodal_sample("Question", image_count=2, audio_seconds=3.0)


def test_register_gemma4_tools_with_server() -> None:
    """Verify register_gemma4_tools with mock MCP server."""

    class MockServer:
        def __init__(self):
            self.registered = []

        def tool(self):
            def decorator(fn):
                self.registered.append(fn.__name__)
                return fn

            return decorator

    server = MockServer()
    tools = register_gemma4_tools(server)
    assert len(tools) == 4
    assert len(server.registered) == 4
    assert "gemma4_list_models" in server.registered
