# @aphrody/m3-mcp

The design/UI tool host of aphrody-m3: packages, M3 tokens, docs, research links, templates,
Material Symbols and desktop icons, served from this repository's files. It is not an MCP server:
the single `aphrody-mcp` hosts these tools (`aphrody mcp-server`, alias `m3-mcp`).

```sh
bun src/tool-host.ts list                          # tool definitions (JSON)
bun src/tool-host.ts call m3_token_lookup '{"query":"primary"}'  # one MCP-shaped result
```

| Tool | Does |
| --- | --- |
| `m3_list_packages` | workspace packages with versions |
| `m3_token_lookup`, `m3_token_validate` | look up and validate M3 tokens |
| `m3_os_themes_list`, `m3_os_themes_generate` | OS theme targets of `@aphrody/m3-os-themes` (dry run) |
| `m3_docs_search`, `m3_research_links` | search `docs/`, list research links |
| `m3_list_templates` | `templates/` |
| `m3_symbol_svg`, `m3_symbol_search` | Material Symbols SVG and catalogue search (`@aphrody/material-design-icons`) |
| `m3_svg_to_ico` | SVG to Tauri desktop icons |

Sources: `src/tools.ts` (tool table), `src/tool-host.ts` (`list` / `call`), `src/catalog.ts` (file-backed lookups). Tests:
`bun test`; typecheck: `bun run typecheck`. Registered in the aphrody-labs plugins marketplace as
the `aphrody-m3` plugin.
