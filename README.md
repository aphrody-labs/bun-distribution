# aphrody-m3

Private design monorepo of Aphrody-labs. Consumed as the git submodule
`design/aphrody-m3` by aphrody, yolo and iecode (nie, rg); Shenron UI lives here
as `packages/shenron-ui`.

- `packages/*`: Bun workspace packages (`@aphrody/m3*`, `@aphrody/app-ui`,
  `@shenron/ui`, `@rosegriffon/ui`, `@aphrody/material-design-icons`, ...). Private; consumed
  through workspace globs `design/aphrody-m3/packages/*`, never published.
- Framework: `docs/guides/FRAMEWORK.md` (package map, yolo orchestration, theme install per OS). Root scripts
  `build`, `serve`, `compile`, `test`, `lint`, `typecheck`, `install:theme` run through the yolo CLI.
- Package index: `@aphrody/m3` (CLI, Bun plugin), `m3-tokens`, `m3-theme`, `m3-tailwind` (Tailwind v4 preset),
  `m3-front` (web components), `m3-react`, `m3-baseui` (Base UI), `m3-os-themes` (Windows, GNOME, COSMIC,
  Chromium), plus `m3-fonts`, `m3-icons`, `m3-motion`, `m3-primitives`, `m3-forms`, `m3-ai`, `m3-explorer`,
  `m3-design`, `m3-next`, `m3-mcp`, `material-design-icons`, `scaffold`. `apps/web` is the showcase app.
- `forks/*`: submodules of aphrody-labs forks: tailwindcss, base-ui, material-web,
  material-design-icons, material-color-utilities.
- `templates/`, `examples/tauri/`: UI templates and Tauri example apps (copies of the
  Yolo-owned originals; the Rust build keeps using the Yolo paths).
- `docs/`: design docs by category (moved from aphrody `docs/*/ui`), web research in
  `docs/research/M3-WEB-RESEARCH-2026-10.md`.
- Rust UI crates (`crates/ui/*`) stay in aphrody.
- Icons: `bun run icons:ico <symbol|file.svg> --out src-tauri/icons` converts SVG to
  Tauri desktop icons (ico, icns, png) via `tauri icon`.
- Skills and plugin: `aphrody-m3` plugin in the aphrody-labs plugins marketplace.

Clone: `git clone --recurse-submodules git@github-dev:aphrody-labs/aphrody-m3.git`
(forks are shallow-friendly: `git submodule update --init --depth 1`).
