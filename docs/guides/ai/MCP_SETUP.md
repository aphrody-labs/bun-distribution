<!-- SPDX-License-Identifier: Apache-2.0 -->

# MCP setup

Aphrody has two intentional MCP boundaries. They are not interchangeable.

## Public HTTP

The production endpoint is `https://aphrody.com/mcp`, served by
`aphrody-site`:

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

The public catalog is bounded. Runtime JSON-RPC `tools/list` is authoritative
for names, schemas and annotations.

## Local stdio

```sh
cargo build --release -p aphrody-mcp --locked
```

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

Bare `aphrody-mcp` starts the stdio server. `aphrody-mcp client` connects
to another MCP server. The catalog depends on Cargo features; do not copy a
tool count from documentation. `dragonball.*` is enabled by default; `nie.*`
is optional and disabled until NIE is integrated into this monorepo. The stdio
endpoint accepts both the legacy `initialize` flow and the 2026-07-28 stateless
`server/discover` flow.

## Plugin boundary

The unified plugin in `plugins/aphrody` registers both the OS kernel MCP
(`aphrody-kernel mcp`) and the AI/Dragon Ball MCP (`aphrody-mcp server`). They
are separate processes and permission boundaries.

## Security

Never place tokens, cookies or credentials in manifests or repository files.
Validate transport, origin and tool permissions before enabling a remote server.
