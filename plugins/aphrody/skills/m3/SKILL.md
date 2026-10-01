---
name: m3
description: "@aphrody/m3 framework: m3 CLI (new, dev, build, compile, desktop, tokens, check), m3.config.ts, the Bun plugin (Tailwind v4, Rust Sass, m3:* modules), serveM3, buildM3, M3App. Use when a project depends on @aphrody/m3."
version: "1.1.0"
---

<!-- SPDX-License-Identifier: Apache-2.0 -->

# m3: the @aphrody Material Design 3 framework

`@aphrody/m3` is the dev, build and theming path for Material 3 apps on Bun: `Bun.serve` and
`Bun.build`, never Vite. Source: `packages/ui/m3` in the Aphrody monorepo (repo-relative paths
below refer to that checkout). Framework design: `docs/architecture/ui/design/M3-FRAMEWORK.md`;
phase status: `docs/plans/ui/design/M3-PLAN.md`. For Material 3 design questions use the
`material-3` and `responsive-adaptive` skills; for Bun APIs use `bun`.

**Outside the monorepo**, the package still needs two things: the native `@aphrody/bun`
library (it provides `m3Css` and the Rust Sass compiler; loaded only when a sheet or `.scss`
is requested) and an asset root holding `crates/ui/bun/icons/material-symbols/` and
`assets/fonts/google-sans-flex/`. Point `APHRODY_OS_ROOT` (or the plugin's `root` option) at
a checkout or bundle that has them, or generate a self-contained bundle once with
`m3 tokens --bundle <dir>`. Install with the project's package manager; inside the monorepo
use `"@aphrody/m3": "workspace:*"`.

## An app in three files

`m3.config.ts` (paths are relative to it):

```ts
import { defineM3Config } from "@aphrody/m3/config";

export default defineM3Config({
  entry: "src/index.html",                        // served on /*, bundled by m3 build
  port: 3000,                                     // PORT overrides it
  proxy: { "/rpc": "http://localhost:8080" },     // the prefix and everything below it
  tauri: { uiDist: "../src-tauri/ui-dist" },     // Tauri frontendDist (e.g. crates/ui/app/ui-dist)
  theme: { seed: "#6750a4", variant: "tonalSpot", contrast: 0 },
});
```

`bunfig.toml` (the dev server only takes plugins from here):

```toml
[serve.static]
plugins = ["@aphrody/m3/plugin"]
```

`package.json`: `@aphrody/m3` in `devDependencies`, scripts `"dev": "m3 dev"`,
`"build": "m3 build"` (or `"m3 build --tauri"`). For the `m3:*` and `?url` module types, add
`/// <reference types="@aphrody/m3/client" />` in a `src/*.d.ts`.

## CLI

| Command | Does |
| --- | --- |
| `m3 dev [--port n] [--no-hmr]` | `serveM3`: `Bun.serve` with HMR and browser console, SPA fallback, proxy prefixes. Warns when `bunfig.toml` lacks the plugin. |
| `m3 build [--outdir d] [--dev]` | `buildM3`: one minified `Bun.build` with the plugin, hashed chunks. |
| `m3 build --tauri [dir]` | Tauri webview layout: `index.html`, `app.js`, `app.css`, `fonts/`, no hashes; `dir` defaults to `tauri.uiDist`. |
| `m3 new <dir>` | Scaffold a minimal Bun/M3 project (the `web` template of `@aphrody/scaffold`); no install, no network. |
| `m3 compile [--outfile f] [--dev]` | `Bun.build({ compile: true })` with the plugin: one standalone executable (default `<outdir>/app`). |
| `m3 desktop [--dev\|--build]` | Tauri host: `--dev` serves the webview on port 1421 (`--port` overrides); otherwise builds into `tauri.uiDist`. |
| `m3 tokens [--sheet tokens\|tailwind\|spaceui\|scheme] [--seed] [--variant] [--dark] [--contrast] [--out f]` | One sheet from the `aphrody-m3-tokens` crate (`crates/ui/m3-tokens`) through `m3Css` (FFI). Stdout without `--out`. |
| `m3 tokens --bundle <dir> [--root d]` | Self-contained bundle: every sheet, light and dark schemes, fonts, `manifest.json`. |
| `m3 check` | `bun run bun:check` in the nearest ancestor whose `package.json` defines it, then `bun test` in the app. |

`dev`, `build`, `compile` and `desktop` read `m3.config.ts` from the working directory
(`--config <file>` overrides).

## Plugin modules

Import them from TypeScript (`import "m3:symbols.css"`) or link them from the HTML
(`<link rel="stylesheet" href="m3:theme.css">`). Do not `@import` them from a Tailwind CSS file:
Tailwind resolves its own `@import`s and cannot see plugin modules.

| Module | Content |
| --- | --- |
| `m3:theme.css` (`m3:tokens.css`) | Fusion tokens (M3, shadcn, Tailwind aliases, light and dark) for `theme` of `m3.config.ts`. |
| `m3:tailwind.css`, `m3:spaceui.css`, `m3:scheme.css` | The other `m3Css` sheets. |
| `m3:symbols.css`, `m3:symbols-rounded.css`, `m3:symbols-sharp.css` | Material Symbols from the `icons` module of the `aphrody-bun` crate (`crates/ui/bun/icons/material-symbols`). |
| `m3:fonts.css` | Google Sans Flex from `assets/fonts/google-sans-flex`. |
| `./file.ext?url` | The file inlined as a `data:` URL (`.scss` line comments stripped). |

The plugin also runs Tailwind v4 on every CSS root and compiles `.scss` imports to Lit `css`
modules through Rust (`sassRustPlugin` from `@aphrody/bun`). The native library loads only when
a sheet or a `.scss` file needs it. Programmatic use:
`Bun.build({ plugins: [m3Plugin({ theme, css?, root? })] })`. `css` replaces `m3Css`, for
example in tests. `root` (or `APHRODY_OS_ROOT`) points at the checkout that holds the fonts.

## React and Lit

```tsx
import { M3App, mountM3App, useM3SizeClass, useM3Theme } from "@aphrody/m3/react";
mountM3App("#root", <App />, { theme: { seed: "#6750a4", mode: "system" }, motion: "default" });
```

`M3App` composes `M3ThemeProvider` (`@aphrody/m3-theme/react`), the M3 window size class
(`@aphrody/m3-react/adaptive`, also set as `data-window-size-class` on `<html>`) and a
`MotionConfig` with the `@aphrody/m3-motion` springs and `reducedMotion: "user"`.

Vanilla or Lit: `import "@aphrody/m3/lit"` registers the `aphrody-components` elements;
`registerM3Components({ core: true })` adds the upstream `md-*` catalog;
`applyM3Theme(seed, { dark, variant })` applies a dynamic scheme.

## Gates

In an app: `m3 check` (or the app's own `test` / `typecheck` scripts).

In the monorepo, for the framework itself:

```sh
bun run bun:check
bun run --cwd packages/ui/m3 test && bun run --cwd packages/ui/m3 typecheck
bunx turbo run typecheck build --filter=@aphrody/m3
```

The Aphrody desktop app (`crates/ui/app/tauri.conf.json`) expects the webview at
`devUrl` `http://localhost:1421` and the built UI in `frontendDist` `ui-dist`; it defines no
`beforeDevCommand`, so start `m3 desktop --dev` (or `m3 dev --port 1421`) yourself and build
with `m3 build --tauri` before bundling.
