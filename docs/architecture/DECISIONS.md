# Design and UI repository decisions (2026-10-04)

- **Name:** `aphrody-labs/aphrody-m3` is the single design and UI repository (private). No separate `aphrody-design` or `aphrody-ui` repo.
- **Layout:** `packages/` (m3-*, app-ui, scaffold, material-design-icons, m3-mcp), `forks/` (submodules: tailwindcss, base-ui, material-web, material-color-utilities, material-design-icons), `templates/` (base, web, desktop, react, elysia, hono), `examples/`, `docs/` (including `research/GOOGLE-LINKS.md`).
- **App UI:** `packages/nie-ui` (submodule `aphrody-labs/nie-ui`), `packages/shenron-ui`, `packages/rg-ui`; consumers (aphrody, yolo, iecode) mount this repo at `design/aphrody-m3`.
- **MCP:** `packages/m3-mcp` is the only design MCP (8 tools); the Claude plugin `aphrody-m3` launches it.
- **Icons:** `bun packages/material-design-icons/scripts/svg-to-ico.ts <symbol|file.svg> --out src-tauri/icons` produces ICO, ICNS and PNG sets for Tauri apps; `templates/desktop/src-tauri/icons` is generated this way.
- **Ownership split:** Bun FFI in yolo (`@aphrody/runtime-sdk/ffi`), Rust in aphrody, systemd/nginx/host config in yolo `config/host`.

## Standalone install (2026-10-04)

`bun install` works in this repo alone: it carries its own `workspaces.catalog` (83 pins merged from the aphrody and iecode roots) and uses the registry `@aphrody/bun`. Packages bound to host workspaces (`app-ui`, `rg-ui`, `shenron-ui`, `web-to-tauri`) are excluded here and resolve from the host monorepo (aphrody) that mounts this repo at `design/aphrody-m3`.
