<!-- SPDX-License-Identifier: Apache-2.0 -->

# One scaffolder for the UI stack

Owner: `packages/scaffold` (`@aphrody/scaffold`, CLI `aphrody-scaffold`, `bun run ui:scaffold`).
Every project the UI stack generates goes through it.

| Template | Output | Used by |
| --- | --- | --- |
| `web` | Bun + M3 web project | `m3 new` (`@aphrody/m3`) |
| `app` | Vite + React app with the Next.js shims, desktop (Tauri 3) or web | `next-migrate` (`@aphrody/m3-next-migrate`) |
| `example` | the canonical example: `app` + Tauri 3 + M3 + README | docs, CI, `aphrody-scaffold example <dir>` |

`tauriShell` writes `src-tauri/` (Cargo.toml, build.rs, main.rs, tauri.conf.json, capability, icon)
for the `app` template and for the projects `web-to-tauri` generates, so the Tauri 3 pins, the
explicit wry/CEF runtime, the lean feature set and the placeholder icon live in one place.

- **Pins**: `src/pins.ts` is the only `TAURI_3` literal. `config/tauri-upstream.json` `mirrors`
  lists it, `bun run tauri:sync` checks and rewrites it. `m3-next-migrate` and `web-to-tauri`
  re-export it.
- **Writing**: `writeFiles(dir, files, mode)` checks every path before writing; modes `new`
  (directory must not exist), `empty`, `merge` (never overwrites) and `overwrite` (migration output).
- **One example**: there is no other example project to maintain. Documentation examples are
  generated from `example` or point at `apps/koharu/editor`, the one real Tauri 3 front end.
- **Adding a template**: add a file under `src/templates/`, register it in `src/index.ts`
  (`TEMPLATES`, `renderTemplate`), and test it in `test/scaffold.test.ts`. Reuse `tauriShell`
  rather than writing a Tauri config.

No generator may copy these helpers. If a package needs a PNG, a name derivation or a Tauri file,
it imports them from `@aphrody/scaffold`.
