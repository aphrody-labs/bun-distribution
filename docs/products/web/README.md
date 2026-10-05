<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody Web

Browser and web capability owner: Obscura, BXC, extraction/indexing/rendering,
X clients, native FFI and the `aphrody-site` HTTP origin.

## Layout

- `crates/aphrody-web*`: facade, engine/service, BXC bridge, FFI, render, extraction,
  indexing and Chromium profile support.
- `docs/reference/web/crates/aphrody-obscura`: pinned upstream engine; `aphrody-browser` exposes its
  subsystem on a dedicated V8 thread.
- `crates/aphrody-site`, `aphrody-x*`: HTTP origin and X client/ranking.
- `drive-server/`: isolated FSL-1.1-ALv2 `sd-server` migration workspace;
  consumes the OS Drive core and the compiled UI bundle from sibling repos.
- `apps/bxc`, `packages/x`, `packages/bxc-test`: Bun engine, client and test adapter.
  FUT has moved to its independent repository.

Cargo dependencies point to Contracts, OS and Compat. UI canvas execution is a
process boundary. No reverse Cargo/Bun dependency on AI; Infra owns public routing.
Changing public crate paths requires migrating affected sibling consumers.

## Build and docs

Use repository pins, Bun and `RUSTC_WRAPPER=`. [AGENTS.md](../../reference/web/AGENTS.md) owns NHITL
and gates; Rust tests use nextest because they mutate process-global state.
Windows V8 requires the configured `/OPT:NOICF` linker flag.

Obscura's DOM/CDP build is the default. Its Taffy layout and raster/text renderer
are opt-in because they add a substantial dependency graph:

```sh
cargo build -p aphrody-web-engine --release
cargo build -p aphrody-web-engine --release --features render
cargo build -p aphrody-web-engine --release --features stealth
```

The `stealth` profile also enables `render`, as required by Obscura's runtime
transport variant. Browser subsystem consumers can opt into `render` or
`stealth` on `aphrody-browser` when they need those MCP capabilities.

- [Web index](../../reference/web/web/INDEX.md), [runtime boundaries](../../reference/web/WEB-RUNTIME.md)
- [BXC manual](./apps/bxc/README.md) and [local agent rules](../../reference/web/apps/bxc/AGENTS.md)
- [X](./x/README.md), [Chromium](./chromium/README.md), [URL conventions](../../reference/web/URL-SLUG-SEO.md)

The main Cargo workspace is Apache-2.0; `drive-server/` has its own FSL license
and Cargo workspace. Record Obscura modifications in its
`OBSCURA-UPSTREAM.txt`; never edit BXC's vendor tree directly.

## Automatisation transversale

Le contrôle des workspaces BXC est fourni par `yolo ops workspace-layout` via `apps/bxc`.
