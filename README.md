# Bun OS

Bun OS is the unified Aphrody/Bun product workspace. It combines the OS
distribution factory, shared Bun packages, desktop application, and pinned
library/runtime sources under one root Bun workspace. Source repositories are
kept as revision-locked submodules so their histories and license notices stay
available.

Bun Libraries and Aphrody are the selected integration scope. Aphrody retains
AI and infrastructure; Shenron and IECODE stay outside this absorption.
`bun src/cli.ts workspace` reports scoped source coverage and local state.
See [source workspace integration](docs/SOURCE-WORKSPACE.md) for migration
and protected-state boundaries.

## Setup and quality

Requires Bun 1.4.4, Git, and the native toolchains for the targets being built.

```sh
bun run setup
bun check -p tsconfig.json --threads=2 --no-pretty
bun lint --deny-warnings src container factory infra packages apps/desktop scripts
bun fmt --check --config bun-format.json --ignore-pattern '**/*.html' src container factory infra packages apps/desktop scripts
bun n2b
```

Type checking, lint, formatting and Node-to-Bun migration use Bun's native
commands directly. They do not invoke external checker binaries or wrapper
scripts.

`setup` initializes the root locked submodules, installs the single Bun
workspace from `bun.lock`, and selects the shared Cargo `target` and `install`
directories. Nested submodules remain pinned but are fetched only when their
owning component requires them. Run `bun run workspace --help` for library
inventory and capability commands.

ArtCraft's physical frozen installation and frontend compilation pass on native
Windows. Nested install retirement still requires dependency alignment; inspect
`just install-plan` and [install qualification](docs/UNIFIED-INSTALL.md).

```sh
bun run frontend:build
```

This delegates to the existing ArtCraft compiler with a fresh output under
`build/frontend/artcraft`. For a later build, select a fresh root output with
`bun run frontend:build --output build/frontend/<name>`. Browser execution,
desktop binaries and deployment require their own qualification.

## Distribution factory

Arch Linux is the primary Linux package model, with pacman/libalpm and one
root factory. Complete CachyOS, ChimeraOS and Omarchy source/recipe catalogs
feed separate headless Server, COSMIC Desktop and Gamescope Gaming compositions.
See [factory usage](factory/README.md) and
[architecture decisions](docs/architecture/arch-distribution.md).

```sh
bun run factory --action plan --composition server --snapshot YYYY-MM-DD
bun run graph --composition server
```

```sh
bun src/cli.ts --help
bun src/cli.ts plan --profile full --target linux-x64
bun src/cli.ts sources --out ./out/full-new --config ./factory.local.json
bun src/cli.ts stage --out ./out/full-new --profile full --target linux-x64 --runtime ./ARTIFACT --receipt ./RECEIPT.json
bun src/cli.ts rootfs-stage --out ./out/full-new --receipt ./ROOTFS-RECEIPT.json --composition server
bun src/cli.ts image --out ./out/full-new --root /ABSOLUTE/FACTORY --profile full --target linux-x64 --composition server --tag bun-os:server
```

Profiles and ABIs are in `distribution.json`; source revisions are pinned in
`sources.lock.json`. Staging requires the exact locked runtime, target, ABI,
hash, byte count, and native runtime qualification. A local Bun snapshot does
not qualify a different locked runtime.

The package converter parses ALPM metadata without executing PKGBUILDs.
Pacman installs the exact signed closure offline through the root factory.
APT remains a separate compatibility target. `bun run build` assembles the
staged product image; `bun run desktop:web:build` bundles the desktop frontend.

## Libraries, desktop, and apps

Root packages include the shared workspace/process/hash owners, video adapter,
artifact compiler, package converter, and desktop application. Library sources
are flat in `crates/`, `packages/` and `apps/` (docs in `docs/libraries/`); the Bun runtime and Tauri SDK source are
pinned below `toolchains/bun/`. App builds and shared assets use the
`@aphrody/bun-artifacts` and `@aphrody/bun-workspace` owners.
Shared Craft font assets, licenses and optional embedding are integrated under
`fonts/` and `crates/craft-fonts`; see [font ownership and provenance](docs/fonts.md).
The two font crates are pinned private forge submodules under the flat
`crates/` directory. See [crate ownership](docs/crate-submodules.md) for the
shared nightly, workspace and access contract.

The root owns one Bun `node_modules`, the nightly toolchain, Cargo intermediate
outputs in `build/rust`, and shared `target` and `install` locations.
Imported JavaScript packages are selected explicitly through the root build
owner:

```sh
just packages-plan paths,ovh,kernel-client
just packages-build paths,ovh,kernel-client
```

The plan reports absent or unmigrated workspace members. Successful builds
write JavaScript and hash receipts under `build/packages/<package>`; those
receipts do not qualify execution, installation, or deployment.
The three flat package submodules, private histories and recorded build scope
are documented in [package ownership](docs/package-submodules.md).
The runtime's existing build and vendored dependency
trees have not yet been migrated into root-owned locations. Rust source
repositories still declare independent Cargo workspaces; the root Cargo
workspace migration is tracked in [PLAN.md](PLAN.md) and is incomplete until
crate manifests and workspace inheritance have been migrated.

## Architecture and evidence

- [Architecture](docs/architecture.md)
- [App artifacts](docs/artifacts.md)
- [Video adapter](docs/video.md)
- [Builds](docs/builds.md)
- [Deployment control](docs/control-plane.md)
- [PLAN.md](PLAN.md) and [MEMORY.md](MEMORY.md)
