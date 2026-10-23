<!-- SPDX-License-Identifier: Apache-2.0 -->

# Install the @aphrody Material 3 packages

The `@aphrody/m3-*` packages are published on npm under one product version. They target Bun (`engines.bun >=1.4.4`):
the `bun` export condition resolves TypeScript sources, and packages with a build also ship `dist/` for other
bundlers. Every package is Apache-2.0; the SpaceUI-derived React packages are `Apache-2.0 AND MIT` (`LICENSE.spaceui`)
and the bundled typefaces are OFL-1.1 (`@aphrody/m3-fonts/fonts/*-OFL.txt`).

## Release status

- `@aphrody/m3-react@1.4.4` and `@aphrody/m3-front@1.4.4` on npm depend on a local `file:` tarball and do not install.
  The source now declares `@aphrody/material-web` as a peer (`^3.3.3`); the fix ships with the next release.
- `@aphrody/m3-bun@1.4.4` depends on `@aphrody/m3@1.4.4`, which is not on npm. The umbrella package `@aphrody/m3` is
  private in this repository; npm still serves an older `@aphrody/m3@3.3.10` from the retired `aphrody-m3` repository.
  `m3-bun` works inside this workspace only, until `@aphrody/m3` is published.
- Packages published as 1.4.4 lack `dist/` and the Material Symbols font files. The source now builds them in
  `prepack`, so the next release carries them. Under Bun the `bun` condition already resolves the sources.

## Quick start: a Bun web app

Tokens, theme, fonts and the React wrappers of the `<md-*>` web components:

```sh
bun add @aphrody/m3-tokens @aphrody/m3-theme @aphrody/m3-fonts @aphrody/m3-react @aphrody/material-web react react-dom
```

```html
<!-- index.html -->
<!doctype html>
<html lang="en">
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

```tsx
// main.tsx
import "@aphrody/m3-fonts/fonts.css";
import "@aphrody/m3-theme/tokens.css";
import { applyDynamicColor } from "@aphrody/m3-tokens/dynamic-color";
import { MdFilledButton } from "@aphrody/m3-react/button";
import { createRoot } from "react-dom/client";

applyDynamicColor("#6750a4"); // optional: replace the default palette with one from a seed colour
createRoot(document.getElementById("root")!).render(
  <MdFilledButton>Hello M3</MdFilledButton>,
);
```

```sh
bun ./index.html
```

`tokens.css` declares the `--md-sys-color-*` roles (light, dark through `prefers-color-scheme` or `<html class="dark">`)
plus the shadcn/ui and Tailwind aliases. `@aphrody/m3-react/<group>` imports one wrapper group (`button`, `textfield`,
`dialog`, ...); `@aphrody/m3-react` imports all of them. Material Symbols: `@aphrody/m3-icons` (inline SVG) or
`@aphrody/m3-fonts/fonts-symbols.css` (variable fonts).

Other component layers on the same tokens: `@aphrody/m3-baseui` (Base UI), `@aphrody/m3-primitives`,
`@aphrody/m3-forms`, `@aphrody/m3-explorer`, `@aphrody/m3-ai` (React, Tailwind classes), `@aphrody/m3-front`
(framework-free `<m3-theme>`), `@aphrody/m3-motion` (Motion transitions), `@aphrody/m3-reader` (manga reader).

## Tailwind v4

```sh
bun add tailwindcss bun-plugin-tailwind @aphrody/m3-tokens @aphrody/m3-tailwind
```

```css
/* app.css */
@import "tailwindcss";
@import "@aphrody/m3-tokens/m3-tokens.css";
@import "@aphrody/m3-tokens/expressive.css";
@import "@aphrody/m3-tailwind/preset.css";
```

```toml
# bunfig.toml
[serve.static]
plugins = ["bun-plugin-tailwind"]
```

Link `app.css` from `index.html` and use the M3 utilities: `bg-primary text-on-primary rounded-large
text-title-medium shadow-elevation-2 state-layer`. The preset is CSS only (no JS plugin, no config file). Colour values
come from `@aphrody/m3-theme/tokens.css` or `applyDynamicColor`.

## Bun plugin and CLI: `@aphrody/m3-bun`

`m3-bun` is the app tool of the stack: one Bun plugin (Tailwind v4, Sass, `m3:*` token, font and icon modules,
`?url` imports) and the `m3-bun` CLI (`dev`, `build`, `serve`, `compile`, `package`, `deploy`, `create`).
See the release status above: it is usable from this workspace today.

```toml
# bunfig.toml
[serve.static]
plugins = ["@aphrody/m3-bun/plugin"]
```

```sh
bun packages/m3-bun/bin/m3-bun.ts create web apps/my-app   # starter: web | app | example
bun scripts/workspace-manifests.ts                         # register the new member
bun install && bun run --cwd apps/my-app dev
```

`create` renders the `@aphrody/scaffold` templates (`bun packages/scaffold/src/cli.ts list`); they target members of
this workspace. Guide: [guides/M3-BUN.md](guides/M3-BUN.md).

## Design CLI: `@aphrody/m3-design`

```sh
bun add -d @aphrody/m3-design
bunx m3-design search "fintech dashboard"
bunx m3-design contrast "#6750a4" "#ffffff"
bunx m3-design compile --prompt "booking app for a barber" --color "#0b57d0"
```

`search` and `system` query the bundled UI/UX catalogs; `compile` writes an M3 React scaffold from a brief;
`contrast` reports WCAG 2.2 ratios.

## Next.js

```sh
bun add @aphrody/m3-next @aphrody/m3-baseui next react react-dom tailwindcss
```

```ts
// next.config.ts
import { withM3 } from "@aphrody/m3-next";
export default withM3(
  {},
  { reactCompiler: true, cacheComponents: true, typedRoutes: true },
);
```

```css
/* app/globals.css */
@import "tailwindcss";
@import "@aphrody/m3-next/m3.css";
@import "@aphrody/m3-baseui/m3-baseui.css";
```

```tsx
// app/layout.tsx
import { M3Root } from "@aphrody/m3-next/server";
import "./globals.css";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <M3Root readCookie={false}>{children}</M3Root>;
}
```

Migrating an existing app: `@aphrody/m3-next-migrate` (Next 14/15, MUI or Tailwind v3 to Next 16 + M3, and Next to
Tauri or a Bun SPA), `@aphrody/m3-codemods` (MUI to `@aphrody/m3-react`), `@aphrody/eslint-plugin-m3` (lint rules for
`md-*` consumers).

## Other packages

| Package                          | Use                                                                         |
| -------------------------------- | --------------------------------------------------------------------------- |
| `@aphrody/m3-os-themes`          | Windows, GNOME, COSMIC and Chromium themes from a seed (`m3-os-themes` bin) |
| `@aphrody/m3-icons`              | Material Symbols as inline SVG, a Bun plugin and build-time codegen         |
| `@aphrody/material-design-icons` | Material Symbols SVG files for desktop icons (`m3-svg-to-ico` bin)          |
| `@aphrody/m3-mcp`                | Design tool host (tokens, docs, icons) for the `aphrody-mcp` server         |
| `@aphrody/m3-config`             | Dev presets: tsconfig, `Bun.build` preset, DOM test preload                 |

Each package README starts with its install line and a minimal example. The design contract is
[architecture/design/APHRODY-M3-CANONICAL-CONTRACT.md](architecture/design/APHRODY-M3-CANONICAL-CONTRACT.md).
