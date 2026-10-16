<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/m3-icons

Material Symbols as inline SVG, generated from the `aphrody-bun` icons module (variable-font
outlines). No icon font is shipped at runtime.

| Entry                           | Runs in               | Native binding                                                                      |
| ------------------------------- | --------------------- | ----------------------------------------------------------------------------------- |
| `@aphrody/m3-icons`             | Bun / server          | Yes: `m3Icon`, `m3IconNames`, `<M3Icon>`, `<m3-icon>` render through `@aphrody/bun` |
| `@aphrody/m3-icons/browser`     | Browser, `use client` | No: `<M3IconSvg svg={…}>` renders SVG generated ahead of time                       |
| `@aphrody/m3-icons/browser/lit` | Browser               | No: `<m3-icon-svg>` (Lit) inlines SVG set on its `svg` property                     |
| `@aphrody/m3-icons/codegen`     | Build time (Bun)      | Yes: writes one ESM module per icon                                                 |
| `@aphrody/m3-icons/plugin`      | Build time (Bun)      | Yes: resolves `m3:icon/<style>/<name>` imports                                      |

Client bundles must use `./browser` with SVG produced by `./codegen`, the plugin,
or a server call to `m3Icon`; the root entry loads the Bun FFI library when an
icon is rendered.

```tsx
import { M3IconSvg } from "@aphrody/m3-icons/browser";
import home from "m3:icon/outlined/home?fill=1"; // resolved at build time

<M3IconSvg svg={home} title="Home" />;
```

The Lit element `<m3-icon>` (root entry) still renders by name through the native
binding; use `<m3-icon-svg>` from `./browser/lit` in browser bundles.
