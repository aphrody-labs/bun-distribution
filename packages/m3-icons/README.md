<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/m3-icons

Material Symbols as inline SVG, rendered by the `@aphrody/bun` icons module from the variable-font outlines; no icon
font ships at runtime.

```sh
bun add @aphrody/m3-icons react
```

```tsx
import { m3Icon } from "@aphrody/m3-icons"; // Bun / server: native binding
import { M3IconSvg } from "@aphrody/m3-icons/browser"; // browser-safe

const home = m3Icon({ name: "home", fill: 1 });
<M3IconSvg svg={home} title="Home" />;
```

License: Apache-2.0 (`LICENSE`). Install guide: [docs/material/m3/INSTALL.md](https://github.com/aphrody-labs/bun-distribution/blob/os/docs/material/m3/INSTALL.md).

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
