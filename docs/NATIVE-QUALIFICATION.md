# Root native qualification — 2026-10-14

The root snapshot introduced by `ad2474dd` contains 24 flat product crate
submodules. Its locked graph has 564 package identities, including 540 remote
dependencies. This qualification covers those root members; imported runtime
and library workspaces still require migration.

## Completed check

Native Windows Cargo `1.100.0-nightly` with `nightly-2026-09-15` completed:

```sh
cargo --config build/vendor/cargo-config.toml check --locked --offline --workspace --all-features
```

The resumed incremental invocation returned exit 0 and reported completion
in 1 minute 59 seconds. It used the existing native admission owner, jobs 1,
root `target`, and `build/rust`. The temporary source configuration points to
the root vendor; active `.cargo/config.toml` is unchanged.

| Input or evidence | SHA-256 |
|---|---|
| `Cargo.toml` | `cf689021bdf92dc75e2062b3108f44cd94bd3303f5c6c701b2991e165ae3ed5d` |
| `Cargo.lock` | `85bbe01a673f19c365ccad433f63bb120a479886ac8484429d1b2ea9c604e5b2` |
| `rust-toolchain.toml` | `e93446be76d3d27ebbd0b7682d615d0de0a350059e6e33e18bd1330340954a1a` |
| `.cargo/config.toml` | `42e04ea9049614191a47680a9a678243a9f398537736f941c89854ae23285832` |
| Local `build/rust/cargo-check.log` | `ea7c7f4c2666f0b8ddb38f569cb4a0aada25e62e56d285e3fbaf7697d71d4c0e` |

The log is local build evidence, not a shipped artifact. Cargo emitted manifest
warnings; no Rust error prevented this check.

## Full build remains pending

The subsequent offline `build --locked --workspace --all-features` attempts
advanced through dependency code generation, but the Bun launchers terminated
with exit 1 without a Cargo completion result or a Rust error. The direct
serialized Cargo attempt also ended before its 120-second deadline. Its caller
did not reach its final result print. This does not establish a successful build
or the cause of the process exits.

The launcher runtime was the recognized Aphrody Bun
`1.4.4+4b8dee0bc69d2c290111001f2249e63e1dc95b70`. No runtime replacement,
upgrade, global process termination, or interference with the release owner's
site and database processes was performed by this qualification lot. The
runtime owner has received the observed symptoms for coordinated diagnosis.

Vendor compilation and active source replacement remain false. Tests and
Clippy for the newly imported crates remain pending. Neither a Cargo check nor
the separately qualified standalone JavaScript server establishes delivery of
all native applications, an OS image, or production deployment.
