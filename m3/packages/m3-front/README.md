<!-- SPDX-License-Identifier: Apache-2.0 -->

# `@aphrody/m3-front`

Framework-agnostic front layer over `@aphrody/material-web` and `@aphrody/m3-tokens`. No React, no build step.

```ts
import "@aphrody/m3-front"; // defines <m3-theme>
import { registerM3, observeWindowClass } from "@aphrody/m3-front";
await registerM3("all"); // lazy md-* catalog ("aphrody" for the extensions)
observeWindowClass(); // data-m3-width / data-m3-height / data-m3-nav on <html>
```

```html
<m3-theme seed="#6750a4" mode="auto" variant="tonalSpot"> ... md-* elements ... </m3-theme>
```

`<m3-theme>` scopes the dynamic colour roles to its subtree, follows `prefers-color-scheme` in `auto`, and
fires `m3-theme-change`. `registerM3Component("button/filled-button")` loads one element.

`bun test test/` (happy-dom), `bun run typecheck`.
