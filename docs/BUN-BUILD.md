<!-- SPDX-License-Identifier: Apache-2.0 -->
# Building and tuning all of Bun

Source: inventory of `oven-sh` and of `vendor/bun/scripts/build` (2026-10-03; nothing was built). Bun 1.4.2 vendors no
third-party source: `scripts/build/deps/*.ts` pins each C/C++ dependency by commit and the build fetches it. Cargo
dependencies come from crates.io. No Zig is needed after the Rust rewrite.

## Forks under `aphrody-labs` (branch `yolo` = the pinned ref, `main`/default = upstream mirror)

| Fork | Pin on `yolo` | Why |
| :--- | :--- | :--- |
| `WebKit` | `1600131e46b5` (`autobuild-<hash>` release) | JavaScriptCore tuning; own prebuilt `bun-webkit-*` tarballs |
| `mimalloc` | `eab09015` | allocator tuning (JSC allocates through it) |
| `boringssl` | `41bf9b59` | crypto flags |
| `ninja` | `bun` branch `35506e77` | reproducible build tool (`bun-ninja-*`) |
| `rust` | `nightly-2026-09-15-bun` `2987ccd3` | PGO/BOLT-tuned toolchain (`BUN_TOOLCHAIN_RUST`) |
| `llvm-project` | default branch only | Rust-specific LLVM; branch to pin not yet identified |

Not forked: tinycc, lol-html, libuv (patch-free pins), zlib-ng, brotli, zstd, libarchive, c-ares, libdeflate, ls-hpack,
highway, libwebp and the other upstream pins.

## Tuning knobs (all in `vendor/bun/scripts/build`)

`profiles.ts`/`config.ts`/`flags.ts` (profiles, `-march`), `--lto=on|off` (ThinLTO across bun, JSC, Rust),
`--pgo-generate`/`--pgo-use`, `deps/webkit.ts` (WebKit cmake options, prebuilt URL and `WEBKIT_VERSION`),
`BUN_TOOLCHAIN_{RUST,LLVM,CARGO}`, `BUN_WEBKIT_PATH`/`--webkit=local`. ASAN must match between bun and WebKit.

## Next steps (build factory only, no heavy local build)

1. Keep `deps/webkit.ts` on the Bun fork `yolo` branch on the upstream `oven-sh/WebKit` prebuilt releases (the
   `aphrody-labs/WebKit` fork was deleted); a tuned WebKit build is a build-factory artifact, not a fork.
2. Pin the tuned Rust/LLVM toolchain releases; measure with a reproducible benchmark before claiming any speedup.
