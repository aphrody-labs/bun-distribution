# @aphrody/app-ui

The desktop front end of Aphrody: the Tauri webview of `crates/ui/app` in the aphrody repository
(shell, top bar, command palette, chat and Codex surfaces, explorer, models hub, settings,
onboarding, pet). Built on the M3 packages of this repository (`@aphrody/m3-*`, `@aphrody/assets`,
`@aphrody/identity`).

Host-bound: the package is excluded from this repository's workspace (`!packages/app-ui`) and is
installed, built and tested by the aphrody workspace, which provides its host dependencies
(`@aphrody/drive-client`, `@aphrody/koharu-ui`, `@aphrody/shell-web`, ...) and the crate assets it
imports (`crates/ui/identity`, `crates/ui/app`).

| Script | Does |
| --- | --- |
| `bun run dev` | `m3 dev` on port 1421 (`tauri.conf.json` `build.devUrl`) |
| `bun run build` | `build.ts`: `m3 build --tauri` into `crates/ui/app/ui-dist` |
| `bun run test` | `bun test src` (layout parity, chat, history, brand theme, ...) |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run brand` | regenerates the brand theme (`scripts/brand-theme.ts`) |

Configuration: `m3.config.ts` (entry `src/index.html`, Tauri `uiDist`), `bunfig.toml`.
