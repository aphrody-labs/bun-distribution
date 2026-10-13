# Aphrody / Bun

A Bun 1.4.4 monorepo with 16 open source library forks and our pinned Bun Tauri
v3 SDK. Aphrody owns the desktop identity; Bun owns JavaScript tooling.

Video is the current priority. [The video adapter](docs/video.md) reuses native
project, timeline, codec and export owners through Bun.

## Setup

Requires our `aphrody-labs/bun` runtime, Git and native Rust. Windows uses MSVC
through `bun msvc`. Paths resolve from the checkout.

```sh
git clone https://github.com/aphrody-labs/bun-libraries.git
cd bun-libraries
bun run setup
bun run check
```

`aphrody.config.json` and Git submodule pointers pin the same commits.
Setup preserves local changes and installs from `bun.lock`.

## Commands

```sh
bun run catalog                          # library inventory
bun run status --json                     # pinned source state
bun run dev                              # local Aphrody shell
bun run build                            # Bun frontend/backend build
bun run fmt                              # native Bun formatting
bun run desktop:dev                      # native Bun Tauri shell
bun run desktop:build                    # native bundle and Bun sidecar
bun run workspace run photocraft --help  # headless library inspection
bun run workspace build filmcraft        # native library build
bun run workspace check craft-libs        # shared Rust workspace check
```

The shell uses capability labels. Inspection runs only a configured headless
CLI with `--help`. Source names remain internal config and license references.
For an existing binary, use ignored `.local/config.json`:

```json
{ "binaries": { "photocraft": ".local/bin/photocraft-cli.exe" } }
```

Unix binaries omit `.exe`. Native builds are serialized and bounded.
Each native, SSH or Docker target needs its own toolchain and permissions.

## Frontend library tooling

```sh
bun install --cwd libraries/artcraft/frontend --frozen-lockfile --ignore-scripts
bun run frontend:build
```

The imported React source builds with Bun. Its historical Tauri v2 shell and
tests remain source references; our desktop uses Bun Tauri v3.

[Architecture](docs/architecture.md), [provenance](docs/provenance.md),
[style](docs/style.md), [migration](docs/migration.md), [qualification](docs/qualification.md).
Source licenses and notices apply.
JavaScript builds do not qualify native engines, CEF, installers or providers.
