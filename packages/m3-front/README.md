<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/m3-front

Framework-agnostic Material 3 front layer over `@aphrody/material-web` and `@aphrody/m3-tokens`: a `<m3-theme>` element, lazy element registration and window size classes, with no React and no build step.

```sh
bun add @aphrody/m3-front @aphrody/material-web
```

```ts
import { observeWindowClass, registerM3 } from "@aphrody/m3-front"; // also defines <m3-theme>

await registerM3("all"); // lazy md-* catalog ("aphrody" for the extensions)
observeWindowClass(); // data-m3-width / data-m3-height / data-m3-nav on <html>
```

License: Apache-2.0 (`LICENSE`). Install guide: [docs/material/m3/INSTALL.md](https://github.com/aphrody-labs/bun-distribution/blob/os/docs/material/m3/INSTALL.md).

```html
<m3-theme seed="#6750a4" mode="auto" variant="tonalSpot">
  ... md-* elements ...
</m3-theme>
```

`<m3-theme>` scopes the dynamic colour roles to its subtree, follows `prefers-color-scheme` in `auto`, and
fires `m3-theme-change`. `registerM3Component("button/filled-button")` loads one element. `cssFromSeed`, `schemeFromSeed`
and `applyDynamicColor` are re-exported from `@aphrody/m3-tokens/dynamic-color`.

Subpath exports: `./theme-element`, `./register`, `./window-class`.

`bun test test/` (happy-dom), `bun run typecheck`.
