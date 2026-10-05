# @aphrody/yolo-web

The webview of the yolo desktop shell (`crates/engine/yolo-desktop`, Tauri): `src/main.ts` calls the Rust
commands (`get_system_stats`, `run_benchmark`) through `@aphrody/api` (resolved to
`vendor/tauri/packages/api` by `tsconfig.json` paths) and shows the generated Bun capability catalog
(`src/generated/bun-catalog.ts`, written by `yolo generate`).

| Script | Does |
| --- | --- |
| `bun run build` | `build.ts`: `Bun.build` of `src/main.ts` into `dist/` with `index.html` and `favicon.png` |
| `bun run dev` | the same, watched, served on port 1420 (`tauri.conf.json` `devUrl`) |
| `bun run tauri` | the Tauri CLI against `crates/engine/yolo-desktop/tauri.conf.json` |
| `bun run test` | `test/web.test.ts`: browser bundle and favicon |
| `bun run typecheck` / `lint` | `tsc --noEmit` / `oxlint src/` |

The favicon is the 32 px icon of `crates/engine/yolo-desktop/icons`, which also holds the desktop bundle icons.
