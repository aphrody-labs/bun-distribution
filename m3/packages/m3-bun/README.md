<!-- SPDX-License-Identifier: Apache-2.0 -->

# `@aphrody/m3-bun`

The one Bun-native tool for M3 apps: a single Bun plugin and the `m3-bun` CLI. It builds, minifies, serves with HMR,
compiles to one executable, packages and generates deploy configs. One Bun file server serves the UI files and the API
from the same process. Full guide: `docs/guides/M3-BUN.md`.

```sh
m3-bun dev                     # HMR dev server: UI and API in one process (bunfig [serve.static] plugins)
m3-bun build [--minify none|basic|full]
m3-bun serve                   # production server of the build directory
m3-bun compile [--target linux-x64-musl|windows-x64|darwin-arm64|...]
m3-bun package [--rootfs] [--deploy]
m3-bun deploy docker systemd nginx vercel fly cloudflare coolify vscode windows linux-image   # or: all
m3-bun smoke                   # run the executable (yolo runtime when installed), GET /, /healthz, /api/m3/info
```

Inside the Aphrody checkout the same commands run as `yolo m3 bun <command>`.

## The plugin

`@aphrody/m3-bun/plugin` is `@aphrody/m3`'s plugin (Tailwind v4, Sass, `m3:*` token sheets, `?url`) plus what a
standalone checkout needs: the token sheets from `@aphrody/m3-tokens` when the Rust library is absent, the font sheets from
`@aphrody/m3-fonts`, `m3:icons/[style/]name[?fill=1&wght=300]` (Material Symbols SVG markup from the forked catalogue, inlined
at build time) and `m3:optional/<specifier>` (a module that may not be installed: its namespace and `resolved: true`, or
`null` and `resolved: false`).

```toml
# bunfig.toml
[serve.static]
plugins = ["@aphrody/m3-bun/plugin"]
```

```ts
// m3.config.ts
export default defineM3Config({ entry: "src/index.html", theme: { seed: "#6750a4" } });
export const bun = defineM3Bun({ api: "src/api/index.ts", port: 3000, compile: { bytecode: true } });
```

## One process, UI and API

`src/api` exports Bun routes (`defineM3Api`); `Bun.serve` runs them natively next to the file server (cache headers,
ETag, brotli and gzip, SPA fallback, `/healthz`, `/api/m3/info`, security headers, traversal guard). `routesToFetch` turns the
same routes into one `fetch` handler for Cloudflare Workers and Vercel functions.

## Compile: bytecode and the limits

`m3-bun compile` embeds the built files and the API in a generated entry and links it with the Bun runtime. It passes
`bytecode: true` to `Bun.build` (with `minify` as configured and `sourcemap: "none"`): JavaScriptCore bytecode is stored in
the executable, so start-up skips parsing. Measured on the fixture app (medians, same host, interleaved runs):
`--version` 4.3 ms instead of 7.5 ms, first `/healthz` 5.8 ms instead of 9.3 ms; the executable grows by about 1.5 MB.
Bytecode output is CommonJS, so the generated entry has no top-level await. `compile: { bytecode: false }` turns it off.

The executable is not static: glibc targets link libc, libm, libdl, libpthread and the loader, musl targets link musl and
libstdc++. Images carry those libraries (`m3-bun package --rootfs`, the `docker` and `linux-image` targets). Windows
metadata (`compile.windows`) is applied only when compiling on Windows; elsewhere the report says so.

`m3 compile` of `@aphrody/m3` runs this compiler (an optional peer): compiling an HTML entry directly yields an HTML
file, not an executable.

Deploy targets are files; nothing here applies, pushes or reloads anything.
