<!-- SPDX-License-Identifier: Apache-2.0 -->
# M3 plan: decisions and open items

Decisions of the Material Design 3 layer and what is still open. Framework shape:
[`M3-FRAMEWORK.md`](../../../architecture/ui/design/M3-FRAMEWORK.md). Bun layer and manifest contract:
[`../BUN.md`](../../../reference/ui/BUN.md). SpaceUI rebuild: [`SPACEUI-M3-FUSION.md`](../../../architecture/ui/design/SPACEUI-M3-FUSION.md).
Cross-host delivery: [`M3-MULTI-HOST-PLAN.md`](./M3-MULTI-HOST-PLAN.md).
The decisions below describe existing web/Tauri components. Tauri v2 is the current
desktop host; standalone Rust GUIs are evaluated for packaging under the
[host boundary](./M3-MULTI-HOST-PLAN.md). Execute under [NHITL](../../../reference/ui/AGENTS.md).

## Ownership

| Owner | Role |
| --- | --- |
| `crates/aphrody-m3-tokens` | Canonical token contract: HCT, tonal palettes, 2021 dynamic schemes (exact port of `@material/material-color-utilities` 0.4.0), roles, typography, shape, state, elevation, motion, adaptive layout, Google Sans Flex/Code. `sheets` renders `tokens.css`, `tailwind.css`, `spaceui.css`, scheme CSS. |
| `crates/ui/m3-tokens` (`facade` module) | Facade over the tokens (layout, accessibility, icon policy, platform contract); formerly the `aphrody-m3` crate. |
| `crates/ui/bun/icons` (module `icons` of `aphrody-bun`) | Material Symbols fonts (single font source) and SVG generation ([`M3-ICONS.md`](../../../architecture/ui/design/M3-ICONS.md)). |
| `@aphrody/bun` (`packages/bun` + `crates/aphrody-bun`) | FFI to the Rust crates: `m3Css`, HCT maths, Sass compile, icons, render, reproduce. |
| `@aphrody/m3` | Dev server, build, plugin, `M3App`, `m3` CLI. |
| `@aphrody/m3-theme` | Generated sheets, `M3ThemeProvider`, Tauri bridge. |
| `@aphrody/material-web`, `@aphrody/m3-react` | Lit `md-*` components and their React wrappers. |
| `@aphrody/m3-primitives`, `-forms`, `-explorer`, `-ai`, `-reader` | React + Tailwind components for application shells and illustrated reading. |

Two lineages share only tokens and theme: Lit (`material-web` -> `m3-react`) and React/Tailwind
(`m3-primitives` family -> `app-ui`, Drive).

## Decisions

- **D1** `crates/aphrody-m3-tokens` is the canonical token contract. Generated sheets come
  from `@aphrody/bun` calling Rust (`m3Css`); the existing TypeScript dynamic-colour API
  computes runtime schemes with Material Color Utilities and requires parity checks.
  `m3-design/src/hct.ts` still has a separate HSL approximation and must migrate to the
  canonical engine before its themes count as M3 output.
- **D2** Existing web/Tauri shells are React 19 + Tailwind v4 on the `m3-primitives` family (`app-ui`,
  Drive). Lit `md-*` stays the component engine through `@aphrody/m3-react` or vanilla.
- **D3** Bun web and desktop Tauri apps use `Bun.serve` + `Bun.build` through `@aphrody/m3`.
  Next.js uses its host tools and shared M3 outputs. Mobile browser and installed Android/iOS
  hosts follow the [delivery plan](./M3-MULTI-HOST-PLAN.md); no mobile adapter is shipped yet.
- **D4** Lockstep `aphrody.m3Version` for the published M3 family, enforced by
  `bun run bun:check` (rule `m3`).
- **D5** Fonts and icons ship from crates (`aphrody-bun` icons module, `aphrody-m3-tokens`) and
  `packages/m3-fonts`; no copies under `assets/` or in other packages.
- **D6** Upstream-derived application trees (`packages/aphrody-spaceui`, `drive`) remain
  provenance archives or runtime owners. Tauri and its plugins are external pinned Git
  dependencies of the current desktop host, not vendored source trees in this repository.
- **D7** Untracked local originals are never deleted by agents.
- **D8** The `aphrody-m3-tokens` public API stays additive: `../aphrody-ai` consumes it by path;
  run `cargo check --workspace` there after Rust changes.
- **D9** Base UI is the headless React layer under `@aphrody/m3-primitives`; Tauri v2 apps build
  through `@aphrody/m3`.
- **D10** Light by default: GPU rendering behind the `gpu` feature (`aphrody-render`), icons as
  per-icon ESM SVG modules, heavy dependencies behind cargo features and lazy imports.

## Repository boundary

**Decision: keep M3 in the Aphrody Rust + Bun monorepo; do not create a separate M3
repository.** Its canonical Rust token crates, Bun FFI, Bun framework packages, React/Lit
adapters and consuming applications share source changes and release gates. The destination
is the `aphrody` workspace described in the [root consolidation plan](../../workspace/PLAN.md).

Keep the npm package family (`@aphrody/m3`, `@aphrody/m3-theme`, components and adapters) as
independently addressable consumer APIs. The existing lockstep `aphrody.m3Version` is the
release contract; a shared repository does not require flattening them into one package.
React/Tailwind and Lit remain separate renderers of the same token and accessibility contract.
Base UI and Tailwind retain their upstream fork histories and build workspaces, pinned as
upstream inputs rather than rewritten as M3 implementations.

This boundary follows the actual dependency graph: `@aphrody/m3` consumes `@aphrody/bun`,
`aphrody-bun` consumes `aphrody-m3-tokens`, and `app-ui` consumes the M3 packages in the Bun
workspace. Their manifests currently point at more than one Git repository; normalize those
metadata and import histories during migration. Independent npm publication remains supported.

## Status

Phases 0-3 (ledger, `packages/m3-config` presets and lockstep, exact MCU port and Rust-generated
sheets, the `@aphrody/m3` framework), 3b-3d, 4a, 4b, 4c, 4d, 4e, 5a, 5b and 5c are done.

| Item | Scope | Status | Evidence |
| --- | --- | --- | --- |
| 4b | `m3 compile` and `m3 desktop` CLI contracts | `FAIT` | Implemented in `@aphrody/m3` (`cli.ts`, `config.ts`); passes `test/cli.test.ts` (standalone binary build and Tauri webview output). |
| 4c | Drive web Vite retirement | `FAIT` | Migrated to `Bun.serve` + `Bun.build` in `drive/apps/web`; Vite references and configs retired. |
| 4e | Time picker dial mode | `FAIT` | Interactive clock dial face, 12h/24h toggle, and slider navigation implemented in `@aphrody/material-web/timepicker`; passes `test/components.test.ts`. |
| 5c | `aphrody-render` multiline text | `FAIT` | `rasterize_multiline` and line-height stacking implemented in `text.rs`; deterministic CPU reference passes 65 unit tests. |

## Regeneration

- Theme sheets: `bun run --cwd packages/m3-theme generate && bun run --cwd packages/m3-theme generate:fusion`.
- Tauri webview: `bun run --cwd packages/app-ui build` writes `crates/aphrody-app/ui-dist/`.
- Token bundle: `m3 tokens --bundle <dir>`.
- Material Web: `bun run --cwd packages/material-web build` (tokens, Sass, CSSResult, both
  TypeScript projects).

## Gates

```sh
bun install --frozen-lockfile && bun run bun:check
bun run typecheck && bun run test && bun run build
cargo test -p aphrody-m3-tokens
cargo clippy --workspace --all-targets -- -D warnings
(cd ../aphrody-ai && cargo check --workspace)
```
