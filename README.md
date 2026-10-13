# Bun OS

Bun OS is a development factory for assembling the Bun runtime fork, COSMIC
desktop and Material 3 into complete and performance distribution profiles.
Profile declarations describe the intended distribution; complete OS images
require their own source, runtime, desktop and image receipts.

| Profile | Desktop | Applications | Source payload |
| --- | --- | --- | --- |
| full | COSMIC | complete catalog | complete locked sources |
| perf | COSMIC | desktop core, files, terminal | complete locked sources |

Linux desktop targets use GNU ABI and glibc. Platform targets and features
are declared in distribution.json. Hardware kernels retain their native
Linux, Windows or Darwin owners.

## Distribution factory

```sh
bun src/cli.ts --help
bun src/cli.ts plan --profile full --target linux-x64
bun src/cli.ts sources --out ./out/full-new --config ./factory.local.json
bun src/cli.ts stage --out ./out/full-new --profile full --target linux-x64 --runtime ./ARTIFACT --receipt ./RECEIPT.json
bun src/cli.ts wasm --out ./out/full-new --config ./factory.local.json
bun src/cli.ts image --out ./out/full-new --profile full --target linux-x64 --tag bun-os:full
```

Configure existing checkouts and, when needed, a serialized native Cargo owner.
Paths resolve relative to the configuration. Without an explicit Bun path,
the factory uses APHRODY_BUN_CHECKOUT or locates the checkout containing the
installed executable.

The recursive source lock retains each submodule and revision-specific mount.
The single exporter checks committed files, exact Git topology, complete
inventories and materialized LFS content. Populated output paths are refused.
Acquisition requires measured sourceExport.estimates and adequate bytes/inodes.
See [the source export contract](docs/SOURCE-EXPORT.md).

Staging requires a complete source receipt and the exact locked runtime
revision, target, ABI, SHA256, byte count and native-runtime qualification.
Linux staging reads the actual glibc loader. A locally runnable Bun snapshot
with another revision can qualify an application build without qualifying
the locked OS runtime. Container recipes validate binary, source and libc
evidence; the Ubuntu toolchain image is separate from a shipped OS image.

## Material framework

The [Rust systems catalog](docs/RUST-SYSTEMS.md) records verified package
identities and placement within the current host and future boot architecture.

Material owns aphrody-m3-tokens, aphrody-m3, libm3 and libm3-wasm.
libm3 consumes the existing native color/design-token owner and the existing
control, accessibility, focus, keyboard, forms and composition models.
It does not define a second palette or control framework.

Dynamic seed colors, nine variants and contrast use the native token engine.
The portable no_std facade accepts computed colors. ABI 2 exposes 49 native
roles and distinguishes navigation bar, collapsed rail and expanded rail.
The typed loader is @aphrody/libm3/wasm in the Material workspace.
ABI 1 artifacts/loaders must not be substituted for ABI 2.

The WASM contract and native adapter compile gates are separate from displayed
GUI, browser component behavior and complete desktop qualification.

## Windows packages and sources

```sh
bun src/build-apt.ts --out ./out/apt-new
./out/apt-new/apt.exe --help
./out/apt-new/apt.exe inspect ./apt_3.2.0.dsc --format deb822 --ecosystem ubuntu
```

The thin APT build adapter calls the single app compiler. It embeds the
selected native Bun executable, records source/runtime/PE identities, and
executes the artifact's version contract. The frontend converts package
metadata, source contracts and qualified native PE payloads. It is distinct
from the official APT installation engine.

WinGet output requires an actual PE executable and explicit non-system runtime
owners. Native DLL archives instead produce native-assets metadata and retain
their original bytes, dependency mappings and licenses. ELF payloads retain
an explicit Windows rebuild contract.

Gzip and bounded Zstandard decoding use native runtime APIs. XZ and bzip2
members require an explicitly configured native 7-Zip decoder; that dependency
is not embedded in apt.exe. Detached signatures, DLL execution and package
transactions have separate qualification gates.

## Applications, routing and deployment

infra/apps.json inventories actual applications, source owners, target
snapshots and scoped asset roots. The single compiler bundles JavaScript,
embeds qualified native backends/assets and produces receipts. Missing native
backends, unresolved external context and unsupported ABI inspection fail the
independent-build gate. Shared asset objects use objects/sha256/<digest> once,
with per-app references.

The existing aphrody-app Worker owns public application hostnames.
DNS/HTTPS routing does not imply native application deployment.
The Rust deployment control and forge/workflow stack is a prepared profile;
activation requires qualified persistent contexts, credentials and live services.

- [Standalone builds and shared assets](docs/APP-BUILDS.md).
- [Public app domains](docs/APP-DOMAINS.md).
- [Deployment control and forge](docs/DEPLOYMENT-CONTROL.md).
- [Native source targets](docs/NATIVE-TARGETS.md).
- [Ubuntu factory](factory/README.md).
- [Image recipes](container/README.md).

## Layout

```text
src/                         distribution and APT entry points
factory/                     source export, Ubuntu and native target owners
infra/                       app inventory, builds, assets and deployment profile
container/                   complete/performance image recipes
packages/package-converter/  package and source conversion
sources.lock.json            recursive immutable source topology
distribution.json            profiles, target ABIs and features
```

Use the native Bun commands declared in package.json for authorized migration,
type, lint and format gates. Read [PLAN.md](PLAN.md) and the
[session report](docs/SESSION-REPORT-2026-10-13.md) for the current evidence
and incomplete requirements. Documentation consolidation does not complete
the OS objective.
