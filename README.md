<div align="center">

# Bun OS

**An Arch-based Linux distribution and product workspace built on the Aphrody Bun runtime.**

[Docs](docs/index.mdx) ·
[Quickstart](docs/quickstart.mdx) ·
[Factory](factory/README.md) ·
[Architecture](docs/architecture.md) ·
[Plan](PLAN.md)

[![CI](https://github.com/aphrody-labs/bun-distribution/actions/workflows/ci.yml/badge.svg?branch=os)](https://github.com/aphrody-labs/bun-distribution/actions/workflows/ci.yml)
[![Bun](https://img.shields.io/badge/bun-1.4.4-black?logo=bun)](toolchains/bun)
[![Rust](https://img.shields.io/badge/rust-nightly-orange?logo=rust)](rust-toolchain.toml)
[![License](https://img.shields.io/badge/license-MIT%20%2F%20Apache--2.0-blue)](LICENSE)

</div>

Bun OS ships the [Aphrody Bun runtime](https://github.com/aphrody-labs/bun) as the system runtime of an
Arch Linux distribution. One repository holds the image factory, the desktop, the applications
and every first-party crate and package. The image factory uses pacman/libalpm and runs from
TypeScript. The desktop is COSMIC, with a Gamescope gaming session. The applications include the
Craft creative suite, reverse-engineering tools and game tooling.

## Editions

| Composition | Session          | Purpose                                     |
| ----------- | ---------------- | ------------------------------------------- |
| `server`    | none             | Headless host: Bun services, nginx, systemd |
| `desktop`   | `cosmic-session` | COSMIC desktop with the Material 3 shell    |
| `gaming`    | `gamescope`      | Steam/Proton gaming session                 |

Profiles: `full` (wgpu renderer, every engine) and `perf` (tiny-skia, demand-loaded engines).
Targets: `linux-x64`, `linux-arm64`, `windows-x64`, `macos-arm64`, `wasm`.
Package catalogs: Arch, CachyOS, ChimeraOS and Omarchy. APT is a separate compatibility target.
Source of truth: [`distribution.json`](distribution.json) and [`sources.lock.json`](sources.lock.json).

## Quickstart

Requires Bun 1.4.4, Git, the nightly Rust toolchain from [`rust-toolchain.toml`](rust-toolchain.toml),
and the native toolchain of each target you build.

```bash
git clone https://github.com/aphrody-labs/bun-distribution.git bun-os
```

```bash
bun run setup
```

```bash
bun src/cli.ts plan --profile full --target linux-x64
```

```bash
bun run factory --action plan --composition server --snapshot 2026-10-17
```

`setup` initializes the pinned submodules and installs the single Bun workspace from `bun.lock`.
It also builds `build/packages/material-web.tgz`. Run `bun run setup --plan` to inspect without
installing.

## Repository

| Path                | Contents                                                                   |
| ------------------- | -------------------------------------------------------------------------- |
| `src/`              | Factory CLI: plan, sources, stage, rootfs, image, msys2, graph, infra, ops |
| `factory/`          | Arch factory, compositions, `/usr` images, Ubuntu and MSYS2 compatibility  |
| `crates/` (549)     | First-party Rust crates in one root Cargo workspace                        |
| `packages/` (544)   | First-party Bun packages in one root Bun workspace                         |
| `apps/` (61)        | Desktop, web, CLI and Android applications                                 |
| `vendor/` (113)     | Pinned upstream sources: kernels, Proton, Wine, emulators, toolchains      |
| `toolchains/bun`    | The Aphrody Bun runtime and Tauri SDK                                      |
| `infra/`            | Host, nginx, systemd and DNS desired state                                 |
| `fonts/`, `assets/` | Shared fonts and app assets with their licenses                            |
| `docs/`             | Documentation site ([`docs/docs.json`](docs/docs.json))                    |

## Products

| Product                       | Where                                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| COSMIC desktop and Material 3 | `apps/desktop`, `packages/m3*`, `packages/app-ui`                                                  |
| Craft suite                   | `apps/*craft*`: PDF, CAD, film, photo, vector, sound, word, deck, design, grid, light, effect, fig |
| Reverse engineering (`re`)    | `packages/re`, `crates/re` (`bunre`)                                                               |
| IECODE and nie game tooling   | `crates/aphrody-nie-*`, `packages/inagle`, `apps/iecode-*`                                         |
| Rose Griffon                  | `apps/rg-website`, `apps/rg-bot`, `packages/rg-*`                                                  |
| Aphrody agents, MCP and A2A   | `crates/aphrody-*`, `packages/a2a`, `packages/m3-mcp`                                              |
| Android                       | `apps/bun-android`, `packages/bun-android`, `crates/android-native`                                |

## Development

```bash
bun run check
```

```bash
bun run lint
```

```bash
bun fmt --check
```

```bash
bun scripts/cargo.ts check
```

Type checking, lint, format and Node-to-Bun migration use the native `bun check`, `bun lint`,
`bun fmt` and `bun n2b`. Cargo runs through the serialized wrapper `scripts/cargo.ts`. Build
outputs go to `build/` and `target/`, and installed binaries to `install/`.
The [contributor guide](AGENTS.md) and [CI](.github/workflows) define the gates.

## Documentation

- [Introduction](docs/index.mdx), [installation](docs/installation.mdx), [quickstart](docs/quickstart.mdx)
- [Architecture](docs/architecture.md) and [Arch distribution](docs/architecture/arch-distribution.md)
- [Factory](factory/README.md), [native targets](docs/NATIVE-TARGETS.md), [builds](docs/builds.md)
- [Reverse-engineering pipeline](docs/re-pipeline.md) and [fonts](docs/fonts.md)
- [Deployment control](docs/control-plane.md) and [qualification](docs/qualification.md)

## License

First-party code is MIT ([`LICENSE`](LICENSE)) or Apache-2.0 ([`LICENSE-APACHE`](LICENSE-APACHE)),
as each manifest states. Imported and vendored projects keep their own licenses. See
[`ATTRIBUTION.md`](ATTRIBUTION.md) and [`docs/licenses`](docs/licenses).
