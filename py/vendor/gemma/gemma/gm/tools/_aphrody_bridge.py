# Copyright 2026 DeepMind Technologies Limited & Aphrody Contributors.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Aphrody runtime and MCP bridge for Gemma 4."""

from __future__ import annotations

import contextlib
import dataclasses
from typing import Any, Callable, Iterator, Optional

from etils import epy
from gemma.gm.tools import _manager

with epy.lazy_imports():
  import mcp


@dataclasses.dataclass(frozen=True)
class AphrodyToolDefinition:
  """Definition for an Aphrody-provided native tool."""

  name: str
  description: str
  input_schema: dict[str, Any]
  handler: Callable[..., Any]


@dataclasses.dataclass(frozen=True)
class AphrodyBridgeToolHandler(_manager.ToolHandlerBase, epy.ContextManager):
  """Tool handler for Aphrody MCP and native runtime tools with Gemma 4."""

  tools_registry: dict[str, AphrodyToolDefinition] = dataclasses.field(
      default_factory=dict
  )

  def register_tool(
      self,
      name: str,
      description: str,
      input_schema: dict[str, Any],
      handler: Callable[..., Any],
  ) -> None:
    """Registers an Aphrody tool with the Gemma 4 handler."""
    self.tools_registry[name] = AphrodyToolDefinition(
        name=name,
        description=description,
        input_schema=input_schema,
        handler=handler,
    )

  def _tools(self) -> list[Any]:
    """Returns the list of available tools formatted for Gemma 4."""
    tools = []
    for tool_def in self.tools_registry.values():
      try:
        import mcp.types
        tool = mcp.types.Tool(
            name=tool_def.name,
            description=tool_def.description,
            inputSchema=tool_def.input_schema,
        )
        tools.append(tool)
      except ImportError:
        # Generic dict fallback if mcp library is unavailable
        tools.append({
            "name": tool_def.name,
            "description": tool_def.description,
            "inputSchema": tool_def.input_schema,
        })
    return tools

  def _call_tool(
      self,
      name: str,
      arguments: Optional[dict[str, Any]] = None,
  ) -> Any:
    """Executes an Aphrody tool call from Gemma 4."""
    if name not in self.tools_registry:
      raise ValueError(f"Unknown Aphrody tool: {name}")
    args = arguments or {}
    tool_def = self.tools_registry[name]
    result = tool_def.handler(**args)
    try:
      import mcp.types
      return mcp.types.CallToolResult(
          content=[mcp.types.TextContent(type="text", text=str(result))]
      )
    except ImportError:
      return {"content": [{"type": "text", "text": str(result)}]}

  @contextlib.contextmanager
  def _activate(self) -> Iterator[None]:
    """Activates the Aphrody bridge context."""
    yield
