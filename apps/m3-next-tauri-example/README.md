<!-- SPDX-License-Identifier: Apache-2.0 -->

# `@aphrody/m3-next-tauri-example`

The static export a Tauri webview loads: `withM3(config, { tauri: true })` sets `output: "export"`, unoptimized images, trailing
slashes and `NEXT_PUBLIC_M3_STATIC=1`, so `M3Root` renders a static shell and the pre-paint script applies the saved theme from
the cookie the client writes. No `proxy.ts`, no route handlers, no server cookies. Only the sheets of the components in use are
imported (`core`, `button`, `switch`).

```sh
bun run build      # writes out/; point Tauri's frontendDist at ../out
bun run test
bun ../../packages/m3-next/scripts/examples.ts export    # m3-next static export, then checks out/index.html
```
