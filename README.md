# Aphrody / Bun

A Bun 1.4.4 monorepo with 16 open source library forks and our pinned Bun Tauri
v3 SDK. Aphrody owns the desktop identity; Bun owns JavaScript tooling.

Video is the current priority. [The video adapter](docs/video.md) reuses native
project, timeline, codec and export owners through Bun.

The workspace now owns app identity, provenance, hashes, source coverage,
process lifetime and shared assets. [App artifacts](docs/artifacts.md) embed
real native engines; [the factory](docs/builds.md) builds and qualifies them.
[Infra](docs/control-plane.md) owns deployment, Git hosting and workflows.

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
bun run artifacts list                    # independent app build inputs
bun scripts/build-apps.ts plan             # all app owners and availability
bun run assets plan                       # shared licensed asset manifest
```

The shell uses capability labels. Inspection runs only a configured headless
CLI with `--help`. Source names remain internal config and license references.
For an existing binary, use ignored `.local/config.json`:

```json
{ "binaries": { "photocraft": ".local/bin/photocraft-cli.exe" } }
```

Unix binaries omit `.exe`. Native builds are serialized and bounded.
Each native, SSH or Docker target needs its own toolchain and permissions.
Standalone applications expose their complete engine with `--native` and
require no checkout, Git or Cargo. Their HTTP binding requires a protected
application token. Generation reuses the existing router's JSONL native CLI.

## Frontend library tooling

```sh
bun install --cwd libraries/artcraft/frontend --frozen-lockfile --ignore-scripts
bun run frontend:build
```

The imported React source builds with Bun. Its historical Tauri v2 shell and
tests remain source references; our desktop uses Bun Tauri v3.

[Architecture](docs/architecture.md), [provenance](docs/provenance.md),
[style](docs/style.md), [migration](docs/migration.md), [qualification](docs/qualification.md).
The [session report](docs/session-report.md) records publication and remaining gates.
Source licenses and notices apply.
JavaScript builds do not qualify native engines, CEF, installers or providers.
