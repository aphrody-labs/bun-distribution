# aphrody-m3

Private design monorepo of Aphrody-labs. Consumed as the git submodule
`design/aphrody-m3` by aphrody, yolo and iecode (nie, rg); Shenron UI lives here
as `packages/shenron-ui`.

- `packages/*`: Bun workspace packages (`@aphrody/m3*`, `@aphrody/app-ui`,
  `@shenron/ui`, `@rosegriffon/ui`, `@aphrody/material-design-icons`, ...). Private; consumed
  through workspace globs `design/aphrody-m3/packages/*`, never published.
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
