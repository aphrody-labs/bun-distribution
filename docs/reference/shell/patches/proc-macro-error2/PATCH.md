<!-- SPDX-License-Identifier: Apache-2.0 -->
# proc-macro-error2 2.0.1 compatibility patch

Upstream: [`GnomedDev/proc-macro-error-2`](https://github.com/GnomedDev/proc-macro-error-2),
crates.io `proc-macro-error2` 2.0.1 (the latest release), licensed `MIT OR Apache-2.0`
(`LICENSE-MIT`, `LICENSE-APACHE`). The sources are the published package, unchanged except for
the line below.

## Why

The embedded Nushell pulls it in at build time:
`aphrody-nu -> nu-protocol 0.115.1 -> nu-derive-value 0.115.1 -> proc-macro-error2 2.0.1`.
Rust reports its `__export` module as future-incompatible (E0365, rust-lang/rust#127909):
`pub use proc_macro;` re-exports a private `extern crate` and will become a hard error. Cargo
surfaces it after every build as `cargo report future-incompatibilities`.

## Change

`src/lib.rs`, module `__export`:

```diff
-    pub use proc_macro;
+    pub extern crate proc_macro;
```

The item stays reachable as `proc_macro_error2::__export::proc_macro`, so the macros and every
downstream proc-macro crate expand exactly as before; only the re-export form changes.
`Cargo.toml` drops the `[[test]]` targets and dev-dependencies of the published manifest (they
cannot run outside the upstream repository), nothing else.

## Scope and retirement

- `[patch]` only applies at the root of the workspace being built. It covers this repository's
  own builds; a consumer that builds `aphrody-nu` from its own workspace (`aphrody-os` and
  `aphrody-ui`, both through the `aphrody-shell` facade) needs the same entry in its root
  manifest. `aphrody-ai` only uses `aphrody-terminal-backend` and `aphrody-tui`, so its graph
  does not contain the crate.
- The RustSec "unmaintained" advisory for `proc-macro-error2` (RUSTSEC-2026-0173) applies to
  this copy as well; it is build-time only and never linked into a binary. `cargo deny` only
  matches advisories against registry sources, so while this path patch is active the root
  `deny.toml` carries no ignore for it (an unused ignore is reported as `advisory-not-detected`).
- Remove this directory and the `proc-macro-error2` line of `[patch.crates-io]` when Nushell
  stops depending on `proc-macro-error2`, or when a fixed release is published. Then run
  `cargo report future-incompatibilities` after a clean build to confirm nothing is reported,
  and `cargo deny check`: if the registry `proc-macro-error2` is still in the graph, restore the
  RUSTSEC-2026-0173 ignore in `deny.toml` with its crate path.
