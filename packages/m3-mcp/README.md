<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/m3-mcp

MCP-shaped design/UI tools (packages, M3 tokens, docs, templates, Material Symbols, desktop icons) for a host MCP server; it is not a server itself.

```sh
bun add @aphrody/m3-mcp
```

```ts
import { callM3Tool, listM3Tools } from "@aphrody/m3-mcp";

console.log(listM3Tools().map(tool => tool.name));
const result = await callM3Tool("m3_token_lookup", { query: "primary" });
console.log(result.content[0]?.text);
```

File-backed tools read an M3 source root: set `APHRODY_M3_ROOT` to a checkout that contains `packages/m3-tokens`.

License: Apache-2.0 (`LICENSE`). Install guide: [docs/material/m3/INSTALL.md](https://github.com/aphrody-labs/bun-distribution/blob/os/docs/material/m3/INSTALL.md).

## Tools

The single `aphrody-mcp` hosts these tools (`aphrody mcp-server`, alias `m3-mcp`). From a checkout:

```sh
bun src/tool-host.ts list                          # tool definitions (JSON)
bun src/tool-host.ts call m3_token_lookup '{"query":"primary"}'  # one MCP-shaped result
```

| Tool                                         | Does                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| `m3_list_packages`                           | workspace packages with versions                                             |
| `m3_token_lookup`, `m3_token_validate`       | look up and validate M3 tokens                                               |
| `m3_os_themes_list`, `m3_os_themes_generate` | OS theme targets of `@aphrody/m3-os-themes` (dry run)                        |
| `m3_docs_search`, `m3_research_links`        | search `docs/`, list research links                                          |
| `m3_list_templates`                          | `templates/`                                                                 |
| `m3_symbol_svg`, `m3_symbol_search`          | Material Symbols SVG and catalogue search (`@aphrody/material-design-icons`) |
| `m3_svg_to_ico`                              | SVG to Tauri desktop icons                                                   |

Sources: `src/tools.ts` (tool table), `src/tool-host.ts` (`list` / `call`), `src/catalog.ts` (file-backed lookups). Tests:
`bun test`; typecheck: `bun run typecheck`. Registered in the aphrody-labs plugins marketplace as
the `aphrody-m3` plugin.
