# Drive HTTP server migration workspace

This isolated Cargo workspace owns the additive Aphrody Web copy of
`sd-server`. It retains the original binary name, routes, daemon bootstrap,
Basic authentication, SSE bridge, sidecar delivery and SPA fallback. The
original `aphrody-ui/drive/apps/server` remains in place until runtime parity
and migration are proven.

The imported source is licensed under FSL-1.1-ALv2, separate from
the Apache-2.0 `aphrody-web` workspace. See [PROVENANCE.md](../../../reference/web/drive-server/PROVENANCE.md).
The FSL terms restrict managed cloud and hosted services to third parties;
rights must be reviewed before any such deployment.

## Build boundary

This directory requires sibling checkouts at `../../aphrody-os` and
`../../aphrody-ui`. Rust `sd-core` comes from `aphrody-os/drive/core`;
`rust-embed` reads the compiled M3 web bundle from
`aphrody-ui/drive/apps/web/dist`. No UI source is copied into this workspace.

```sh
cd ../aphrody-ui
bun install --frozen-lockfile
cd ../aphrody-web
RUSTC_WRAPPER= cargo check --manifest-path drive-server/Cargo.toml --bin sd-server
```

The build script runs the UI build when Bun is available. Set
`SD_SKIP_WEB_BUILD=1` only after `aphrody-ui/drive/apps/web/dist/index.html`
exists. In release mode the compiled assets are embedded; debug mode reads
the bundle from disk. The existing server must stay deployed for any consumer
that still needs direct `/`, `/health`, `/rpc`, `/events` or `/sidecar/*` routes.

`aphrody-site` owns the public origin and exposes an opt-in,
Bearer-authenticated gateway under `/api/v1/drive/*`. That gateway is a
separate surface with documented limits; it does not replace this server's
full HTTP and SPA contract. Infra deployment and data cutover remain to be
qualified. The recipes in `upstream/` are archived source
references only and must not be run as Aphrody production deployment steps.
