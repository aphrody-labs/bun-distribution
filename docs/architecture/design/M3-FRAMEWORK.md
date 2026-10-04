<!-- SPDX-License-Identifier: Apache-2.0 -->
# The `@aphrody/m3` framework

Rust owns the canonical tokens. `@aphrody/m3` (`packages/m3`) serves, builds and themes Bun web
and desktop Tauri apps through `Bun.serve` and `Bun.build`. Next.js has a separate adapter;
mobile browser and installed Android/iOS support remain to be qualified. Base UI and Tailwind
CSS are the forked React web foundation, including webviews; native widgets need their own
adapter. Decisions: [`M3-PLAN.md`](../../plans/design/M3-PLAN.md). Cross-host delivery:
[`M3-MULTI-HOST-PLAN.md`](../../plans/design/M3-MULTI-HOST-PLAN.md). Agent guide: the `m3` skill.

## Architecture

```
crates/aphrody-m3-tokens (Rust)   seed -> HCT -> palettes -> roles; type, shape, motion, layout
        |
crates/aphrody-bun -> @aphrody/bun   m3Css({ sheet, seed, variant, dark, contrast })
        |
packages/m3 (@aphrody/m3)   m3Plugin | serveM3 | buildM3 | M3App (/react) | /lit | m3 CLI
        |
        +-- packages/material-web (Lit md-*), packages/m3-react (@aphrody/m3-react)
        +-- packages/m3-primitives, m3-forms, m3-explorer, m3-ai (React 19 + Tailwind v4)
                -> packages/app-ui (Tauri webview), Drive
```

CSS custom properties (`--md-sys-*`) are the common layer: the only values that cross the
shadow DOM of `md-*` elements, and what the `m3:tailwind.css` utilities read.

The Bun workspace links `@base-ui/react` and `@base-ui/utils` from `third_party/base-ui`, and
`tailwindcss` and `@tailwindcss/node` from `third_party/tailwindcss`. `@aphrody/m3-primitives`
uses the Base UI fork with one React resolution. The M3 Bun plugin calls the Tailwind fork's
compiler and the published native `@tailwindcss/oxide` scanner directly. Initialize both
submodules before `bun install --frozen-lockfile` in a fresh checkout.

## Packages

| Package | Tree | Role |
| --- | --- | --- |
| `@aphrody/m3` | `packages/m3` | Plugin, `serveM3`, `buildM3`, `M3App`, Lit entry, `m3` CLI. |
| `@aphrody/bun` | `packages/bun` + `crates/ui/bun` | FFI: HCT maths, `m3Css`, Sass compile (`sassRustPlugin`). |
| `@aphrody/m3-theme` | `packages/m3-theme` | Generated `tokens.css`, `tailwind.css`, `spaceui.css`; `M3ThemeProvider`; Tauri bridge. |
| `@aphrody/m3-tokens` | `packages/m3-tokens` | TypeScript tokens: dynamic colour, breakpoints, platform contract. |
| `@aphrody/m3-motion` | `packages/m3-motion` | Springs, easings, durations. |
| `@aphrody/m3-fonts` | `packages/m3-fonts` | WOFF2 subsets and font stacks ([`FONTS-AND-ICONS.md`](./FONTS-AND-ICONS.md)). |
| `@aphrody/m3-icons` | `packages/m3-icons` | Material Symbols as inline SVG ([`M3-ICONS.md`](./M3-ICONS.md)). |
| `@aphrody/material-web` | `packages/material-web` | Lit `md-*` fork plus Aphrody extension elements. |
| `@aphrody/m3-react` | `packages/m3-react` | `@lit/react` wrappers, `adaptive`, `state`, `transitions`. |
| `@aphrody/m3-primitives`, `-forms`, `-explorer`, `-ai` | `packages/m3-*` | React components for application shells (D2). |
| `@aphrody/m3-next` | `packages/m3-next` | Next.js 16 App Router adapter (`examples/m3-next`). |
| `@aphrody/m3-config` | `packages/m3-config` | Shared tsconfig, tsup and test presets (private). |
| `@aphrody/eslint-plugin-m3` | `packages/eslint-plugin-m3` | M3 lint rules. |

## An application

```
my-app/
  m3.config.ts      entry, routes, proxy, port, tauri.uiDist, theme (defineM3Config)
  bunfig.toml       [serve.static] plugins = ["@aphrody/m3/plugin"]
  package.json      "dev": "m3 dev", "build": "m3 build"
  src/index.html    <link rel="stylesheet" href="m3:theme.css"> + module script
  src/m3-env.d.ts   /// <reference types="@aphrody/m3/client" />
```

`m3 new <dir>` scaffolds this layout. `mountM3App("#root", <App />, { theme })` mounts under
`StrictMode` with `M3ThemeProvider`, the window size class and a `MotionConfig` using
`m3Springs` (`reducedMotion: "user"`).

## Rules and pitfalls

- `m3Plugin` composes Tailwind v4 through `@tailwindcss/node` and `@tailwindcss/oxide`, Sass
  through Rust (`.scss` -> Lit `css`), the `m3:*` modules
  (`m3:theme.css`, `m3:tailwind.css`, `m3:spaceui.css`, `m3:scheme.css`, `m3:symbols*.css`,
  `m3:fonts.css`) and `?url` imports.
- Import `m3:*` from TypeScript or link it from HTML. Never `@import` it from a Tailwind CSS
  file: Tailwind resolves its own imports and cannot see plugin modules.
- `Bun.serve` takes plugins from `bunfig.toml` only; `m3 dev` warns when the plugin is missing.
- `m3 build --tauri [dir]` writes the fixed webview layout (`index.html`, `app.js`, `app.css`,
  `fonts/`) with unhashed names and external module scripts for the `script-src 'self'` CSP.
- `m3 tokens --bundle <dir>` writes a self-contained token/font bundle; no static design-system
  copy is kept in the repository.
- Scheme variants are kebab-case in Rust (`tonalSpot` -> `tonal-spot`).

## Adaptive layout

Window size classes come from `crates/ui/m3-tokens/src/adaptive.rs`: compact `< 600`,
medium `600-839`, expanded `840-1199`, large `1200-1599`, extra-large `>= 1600` (dp), with pane
counts, navigation (bar -> collapsed rail -> expanded rail), grid columns (4/12), margins (16/24)
and `export_breakpoints_css()` (`--md-sys-breakpoint-*` plus Tailwind `--breakpoint-*`). The web
reads the same numbers from `@aphrody/m3-tokens/breakpoints` and `@aphrody/m3-react/adaptive`
(`useWindowSizeClass`, SSR-safe, `compact` until mounted).

## Component Coverage & Web Components Bridge

- **Glossary & Mapping**: The canonical 32 Material Design 3 components and concepts are indexed in `m3-glossary.md`.
- **Web Components (`@aphrody/material-web`)**: Provides ~82 `md-*` web components built on Lit, inheriting custom CSS properties (`--md-sys-color-*`).
- **React Wrappers (`@aphrody/m3-react`)**: Wraps the `md-*` web components via `@lit/react createComponent`, themed by `theme.css` generated from `aphrody design tokens`.
- **Headless React Primitives (`@aphrody/m3-primitives`)**: Headless accessible components backed by `@base-ui/react` and styled with Tailwind CSS v4 utility classes.

## Token Generation CLI & Exports

Tokens originate in Rust (`crates/ui/m3-tokens`, re-exported via `aphrody_m3_tokens::facade`) and can be emitted across formats:
```bash
# Standard CSS custom properties
aphrody design tokens --sheet tokens --out tokens.css

# Fusion with Tailwind v4 inline theme and shadcn registry aliases
aphrody design tokens --fusion --dark --format css
```
- **HCT Engine**: Generates 13 tonal palettes from a single seed color.
- **Tailwind v4 Integration**: `@theme inline` consumes `--md-sys-color-*` and `--md-sys-breakpoint-*`.
- **shadcn Compatibility**: `theme-aphrody.json` (`registry:theme`) bridges M3 design tokens into React/shadcn component pipelines.

