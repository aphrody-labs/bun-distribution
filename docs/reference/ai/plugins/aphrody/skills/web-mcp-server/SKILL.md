---
name: web-mcp-server
description: "Extend the Aphrody Web MCP backend (src/mcp/server.ts): registerTool with Zod, versioning, standalone binary, .mcp.json wiring."
metadata:
  short-description: Extend and verify the Aphrody MCP server.
---

Core file: `src/mcp/server.ts`. Its server version must match the root package.

Build: `bun run build:mcp` → dist/standalone/bxc-mcp (executable).

The canonical entry point is `aphrody web mcp`. The checked-in `.mcp.json` is shared by
Codex and Claude Code and must not depend on a repository-specific absolute path.

Use `@modelcontextprotocol/server` v2 and `serveStdio` so modern MCP 2026-07-28
and legacy clients negotiate through the official SDK. Keep stdout exclusively
for JSON-RPC; diagnostics belong on stderr.

Tools are registered with description + inputSchema (z.object). Keep results small and useful for LLMs.

Keep tool registration deterministic, schemas bounded, descriptions concise,
and results small. Prefer one canonical tool per capability instead of aliases.
