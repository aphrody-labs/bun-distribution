<!-- SPDX-License-Identifier: Apache-2.0 -->

# Model Context Protocol

Aphrody exposes an HTTP MCP gateway and a local stdio server. They implement
the same protocol but have different trust and capability boundaries.

## Public HTTP

`https://aphrody.com/mcp` is served by `aphrody-site` on the unified public
origin. It is intended for bounded public tools. Runtime JSON-RPC `tools/list`
is authoritative for names, schemas and annotations.

```json
{
  "mcpServers": {
    "aphrody-remote": {
      "type": "http",
      "url": "https://aphrody.com/mcp"
    }
  }
}
```

## Local stdio

`crates/ai/mcp` provides the broader local server:

```sh
cargo run -p aphrody-mcp
cargo run -p aphrody-mcp -- client --help
```

`sync_external_agents` (always on, host-only) runs the same library pass as
`aphrody ai sync-sessions` and returns its JSON summary; parameters `agent`
(`agy`, `codex`, `claude`), `live` and `memory` (both default `true`).

Bare invocation starts the server. The `client` subcommand connects to an
external MCP server. Features control optional catalogs; query `tools/list`
instead of relying on a fixed count.

```json
{
  "mcpServers": {
    "aphrody": {
      "type": "stdio",
      "command": "aphrody-mcp"
    }
  }
}
```

The Aphrody Web backend remains an internal implementation behind this
catalog. `bxc` is retained in source and compatibility namespaces until a
versioned rename proves every consumer and route.

## Unified plugin

The single plugin in `plugins/aphrody` registers both `aphrody-mcp`
for system capabilities and `aphrody-mcp server` for AI, RAG and Dragon Ball.
They remain separate MCP processes and permission boundaries.

## Diagnostics

```sh
aphrody mcp --help
aphrody-mcp --help
```
