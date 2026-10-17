# @aphrody/app-ui

The desktop front end of Bun OS: the Tauri webview of `apps/aphrody-app`
(shell, top bar, command palette, chat and Codex surfaces, explorer, models hub, settings,
onboarding, pet). Built on the M3 packages of this repository (`@aphrody/m3-*`, `@aphrody/assets`,
`@aphrody/identity`).

The root Bun OS workspace installs and links this package and its canonical
dependencies. Native execution remains host-bound: the desktop and identity
owners are `apps/aphrody-app` and `crates/aphrody-identity`. Workspace membership
does not prove that a native desktop artifact has been built or launched.

| Script              | Does                                                                         |
| ------------------- | ---------------------------------------------------------------------------- |
| `bun run dev`       | Native M3 development server on port 1421 (`tauri.conf.json` `build.devUrl`) |
| `bun run build`     | `build.ts`: native M3 build into `apps/aphrody-app/ui-dist`                  |
| `bun run test`      | `bun test src` (layout parity, chat, history, brand theme, ...)              |
| `bun run typecheck` | Native `bun check -p tsconfig.json --noEmit`                                 |
| `bun run brand`     | regenerates the brand theme (`scripts/brand-theme.ts`)                       |

Configuration: `m3.config.ts` (entry `src/index.html`, Tauri `uiDist`), `bunfig.toml`.

## Browser transport

From the selected Bun OS root, start the native backend with
`aphrody app-server --http --addr 127.0.0.1:8765`, then serve the built UI with
`bun run desktop:ui:serve`. Development via `bun run dev` uses the same proxy
configuration in `backend.ts`. `APHRODY_APP_SERVER_URL` selects another loopback
HTTP origin.

M3 forwards `/rpc`, `/events`, `/notifications`, `/health` and `/healthz`
unchanged. Backend failures remain failures. Desktop-only commands use real
Tauri IPC in the desktop host; the browser server does not impersonate Tauri.
The frontend starts no backend process and owns no model, crawl or RAG store.
