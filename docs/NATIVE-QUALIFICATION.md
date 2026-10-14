# Root native qualification — 2026-10-14

## Current 28-member build

The root at `defaa2161fed89ae1a0d9dcf84e91947d1318926` completes both the
workspace Cargo check and the offline native build below with nightly
`2026-09-15`, under the shared Windows admission owner:

```sh
cargo --config build/vendor/cargo-config.toml build --locked --offline --workspace --all-features --message-format=json-render-diagnostics
```

The bound receipt contains 28 final artifacts for all 28 members. Intermediate
Cargo metadata and build-script executables do not satisfy artifact coverage.
Its source/toolchain/environment/artifact revalidation passes both directly
and inside the serialized vendor verifier. Rust cache normalization is shared
with execution, preserving effective compiler-wrapper provenance.

- Input key: `61192dd4c50e0a334f4d18ec603b0961ec0596aed3cdd391a33b42a33ce15698`.
- Receipt SHA-256: `0d1ec47cd7038a37190190f9a3fe1f5c936fbd8a6c59737366297d03936db10d`.
- Vendor verification: 543 sources, 571 locked identities, `compiled: true`,
  `buildProof: valid`, `activeSourceReplacement: false`.

This qualifies the current root Rust workspace. Tests were not run. Runtime,
nested library applications, the complete product binary and OS images remain
separate qualification work.

## Earlier 24-member check

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

| Input or evidence                  | SHA-256                                                            |
| ---------------------------------- | ------------------------------------------------------------------ |
| `Cargo.toml`                       | `cf689021bdf92dc75e2062b3108f44cd94bd3303f5c6c701b2991e165ae3ed5d` |
| `Cargo.lock`                       | `85bbe01a673f19c365ccad433f63bb120a479886ac8484429d1b2ea9c604e5b2` |
| `rust-toolchain.toml`              | `e93446be76d3d27ebbd0b7682d615d0de0a350059e6e33e18bd1330340954a1a` |
| `.cargo/config.toml`               | `42e04ea9049614191a47680a9a678243a9f398537736f941c89854ae23285832` |
| Local `build/rust/cargo-check.log` | `ea7c7f4c2666f0b8ddb38f569cb4a0aada25e62e56d285e3fbaf7697d71d4c0e` |

The log is local build evidence, not a shipped artifact. Cargo emitted manifest
warnings; no Rust error prevented this check.

## Earlier incomplete build attempts

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

At that earlier snapshot, vendor compilation and active source replacement
remained false. Tests and
Clippy for the newly imported crates remain pending. Neither a Cargo check nor
the separately qualified standalone JavaScript server establishes delivery of
all native applications, an OS image, or production deployment.

## Jev integration

The next snapshot adds `aphrody-jev` from the canonical Bun prefix with its
history and dual-license notices. The private forge branch `os` is pinned at
`be4a36bd503c79d98619ad39c8b2d0fbc36632eb`; the child is clean and its refs
were read back through the root's qualified SSH transport.

Complete locked metadata and vendor verification now resolve 25 root members
and 568 identities, including 543 remote sources. Existing locked versions
are unchanged. The scoped native command below returned exit 0, with Cargo
reporting completion in 25.80 seconds after cache preparation:

```sh
cargo --config build/vendor/cargo-config.toml check --locked --offline -p aphrody-jev --all-features
```

This checks both optional client and server paths, including the nullable usage
contract and the selected ring TLS provider. A subsequent protocol test build
terminated before producing a test result. It does not count as executed or
passing tests. Source compilation proof, full workspace build, protected
Aphrody consumer migration and production activation remain separate pending
gates. At that earlier snapshot, the build-proof owner reported `compiled:false`
and `buildProof:missing`; the current 28-member evidence above supersedes it.
