# @aphrody/yolo-web

The yolo web demo page: `src/main.ts` calls the `aphrody-app` Rust
commands (`aphrody_system_stats`, `aphrody_benchmark`, `crates/ui/app`; reachable from its main window only) through `@aphrody/api` (resolved to
`vendor/tauri/packages/api` by `tsconfig.json` paths) and shows the generated Bun capability catalog
(`src/generated/bun-catalog.ts`, written by `yolo generate`).

| Script | Does |
| --- | --- |
| `bun run build` | `build.ts`: `Bun.build` of `src/main.ts` into `dist/` with `index.html` and `favicon.png` |
| `bun run dev` | the same, watched, served on port 1420 (`tauri.conf.json` `devUrl`) |
| `bun run test` | `test/web.test.ts`: browser bundle and favicon |
| `bun run typecheck` / `lint` | `tsc --noEmit` / `oxlint src/` |

The desktop is `aphrody-app` (`crates/ui/app`, frontend `m3/packages/app-ui`); there is no separate yolo desktop shell.
