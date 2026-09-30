---
name: m3
description: "@aphrody/m3 framework: m3 dev/build/tokens/check, m3.config.ts, the Bun plugin (Tailwind v4, Sass via Rust, m3:* theme and font modules, ?url), serveM3, buildM3 (Tauri webview), M3App. Use to start, build or theme an M3 web or Tauri app."
---

<!-- SPDX-License-Identifier: Apache-2.0 -->

# m3: the @aphrody Material Design 3 framework

`packages/ui/m3` (`@aphrody/m3`) is the single dev, build and theming path for Material 3 apps in
the Aphrody ecosystem: `Bun.serve` and `Bun.build`, never Vite. It lives in the `aphrody-ui`
repository; every path below is relative to that repository. The framework shape is in
`docs/design/M3-FRAMEWORK.md`, the phase status in `docs/design/M3-PLAN.md`. For Material 3 design
questions (roles, components, adaptive layout) use the `material-3` and `responsive-adaptive`
skills. For Bun API questions use `bun`.

## An app in three files

`m3.config.ts` (paths are relative to it):

```ts
import { defineM3Config } from "@aphrody/m3/config";

export default defineM3Config({
  entry: "src/index.html",                        // served on /*, bundled by m3 build
  port: 3000,                                     // PORT overrides it
  proxy: { "/rpc": "http://localhost:8080" },     // the prefix and everything below it
  tauri: { uiDist: "../../crates/aphrody-app/ui-dist" },
  theme: { seed: "#6750a4", variant: "tonalSpot", contrast: 0 },
});
```

`bunfig.toml` (the dev server only takes plugins from here):

```toml
[serve.static]
plugins = ["@aphrody/m3/plugin"]
```

`package.json`: `"@aphrody/m3": "workspace:*"` in `devDependencies`, scripts `"dev": "m3 dev"`,
`"build": "m3 build"` (or `"m3 build --tauri"`). For the `m3:*` and `?url` module types, add
`/// <reference types="@aphrody/m3/client" />` in a `src/*.d.ts`.

## CLI

| Command | Does |
| --- | --- |
| `m3 dev [--port n] [--no-hmr]` | `serveM3`: `Bun.serve` with HMR and browser console, SPA fallback, proxy prefixes. Warns when `bunfig.toml` lacks the plugin. |
| `m3 build [--outdir d] [--dev]` | `buildM3`: one minified `Bun.build` with the plugin, hashed chunks. |
| `m3 build --tauri [dir]` | Tauri webview layout: `index.html`, `app.js`, `app.css`, `fonts/`, no hashes; `dir` defaults to `tauri.uiDist`. |
| `m3 tokens [--sheet tokens\|tailwind\|spaceui\|scheme] [--seed] [--variant] [--dark] [--contrast] [--out f]` | One sheet from `crates/aphrody-m3-tokens` through `m3Css` (FFI). Stdout without `--out`. |
| `m3 tokens --bundle <dir>` | Self-contained bundle: every sheet, light and dark schemes, fonts, `manifest.json`. |
| `m3 check` | `bun run bun:check` at the workspace root, then `bun test` in the app. |

## Plugin modules

Import them from TypeScript (`import "m3:symbols.css"`) or link them from the HTML
(`<link rel="stylesheet" href="m3:theme.css">`). Do not `@import` them from a Tailwind CSS file:
Tailwind resolves its own `@import`s and cannot see plugin modules.

| Module | Content |
| --- | --- |
| `m3:theme.css` (`m3:tokens.css`) | Fusion tokens (M3, shadcn, Tailwind aliases, light and dark) for `theme` of `m3.config.ts`. |
| `m3:tailwind.css`, `m3:spaceui.css`, `m3:scheme.css` | The other `m3Css` sheets. |
| `m3:symbols.css`, `m3:symbols-rounded.css`, `m3:symbols-sharp.css` | Material Symbols from `crates/aphrody-icons`. |
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

```sh
bun run bun:check
bun run --cwd packages/ui/m3 test && bun run --cwd packages/ui/m3 typecheck
bunx turbo run typecheck build --filter=@aphrody/m3
```

The Tauri desktop runs `m3 dev` on port 1421 (`build.devUrl`) and `m3 build --tauri` through
`beforeDevCommand` / `beforeBuildCommand` in `crates/aphrody-app/tauri.conf.json`.
