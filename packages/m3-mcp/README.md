# @aphrody/m3-mcp

The design/UI MCP server of aphrody-m3 (stdio): packages, M3 tokens, docs, research links,
templates, Material Symbols and desktop icons, served from this repository's files.

```sh
bun run start          # bun src/server.ts (stdio transport)
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

Sources: `src/server.ts` (tool registration), `src/catalog.ts` (file-backed lookups). Tests:
`bun test`; typecheck: `bun run typecheck`. Registered in the aphrody-labs plugins marketplace as
the `aphrody-m3` plugin.
