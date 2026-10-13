# Standalone application builds

`infra/apps.json` inventories distribution targets and product-specific inputs.
Library capability IDs, native Rust engine builds, standalone artifacts and
canonical application hosts belong to Bun Libraries. Bun OS delegates its 14
library builds there. APT and the desktop server retain their configured Bun
entrypoints. An unresolved external context prevents an independent build.

## Owners

| Capability                                               | Owner                                                                       |
| -------------------------------------------------------- | --------------------------------------------------------------------------- |
| Library engine builds and standalone artifacts           | `scripts/build-apps.ts` and `@aphrody/bun-artifacts` in Bun Libraries       |
| Shared Bun standalone compiler                           | `@aphrody/bun-artifacts/compiler` in Bun Libraries                         |
| App source policy, native contracts and release receipts | `infra/app-build.ts` in Bun OS                                             |
| Library capability names and canonical application hosts | `@aphrody/bun-workspace/capabilities` in Bun Libraries                      |
| Child process ownership, deadlines and output capture    | `@aphrody/bun-workspace/process` in Bun Libraries                           |
| Streamed file identity                                   | `@aphrody/bun-workspace/hash` in Bun Libraries                              |
| Cloudflare control and credentials                       | Runtime `packages/bun-cloudflare`; domain changes use the configured MCP    |
| R2 object authentication                                 | Canonical `createR2Client` and `loadCloudflareEnvironment`                  |
| Distribution-specific and embedded byte identity         | Thin `src/distribution.ts` adapter over the shared Bun Libraries hash owner |
| Executable headers                                       | Package converter `abi` and the GNU loader gate in `src/elf.ts`             |
| Distribution app orchestration                           | `infra/app-build.ts`, delegating library builds to Bun Libraries            |
| Shared object plans                                      | `infra/assets.ts`                                                           |
| Edge and public catalog                                  | The edge/catalog capability owner                                           |

## Configuration

A build uses the selected native runtime binary or an explicit target snapshot.
A native runtime path may use `$BUN_INSTALL/<relative-path>` so a mutable Bun
build output is not mistaken for the pinned compiler snapshot. The snapshot pins
its resolved path, SHA256, version and revision. Cross-target snapshots also
require a matching native target receipt with the `native-runtime` gate. The
compiler and snapshot revisions must agree. Runtime metadata reports its source
URL; archive authentication is a separate qualification.

The optional `build` object declares `outputRoot`, `timeoutSeconds`,
`sharedHeavyLock` and `lockKind`. Output paths are relative to the catalog.
The lock kind is `flock` on a qualified Linux host or `exclusive-file`
for the existing native Windows lease protocol. Acquisition is immediate:
an occupied lease is preserved. The workflow also uses the existing
distribution `.factory.lock`.

Each native app provides `native.artifactsByTarget[target]`:

- `path` and `sha256`: exact backend artifact.
- `sourceRevision`: its application source pin.
- `qualificationReceipt`: matching source/artifact evidence with
  `native-backend` and `native-dependency-closure` gates.
- `dependencies`: additional embedded native files, each with path and SHA256,
  an executable/library role, and any ABI or minimum glibc requirements.
- `systemLibraries`, `abi`, `minimumGlibc`: target requirements retained
  from the native owner.

Artifact paths resolve from the catalog. ABI inspection preserves architecture
and runtime distinctions. GNU ELF executables require the actual glibc loader.
The shared ABI owner currently qualifies PE and ELF; Mach-O remains a separate
owner extension.

## Build and release

```sh
bun infra/app-build.ts plan apt --config infra/apps.json --target windows-x64
bun infra/app-build.ts build apt --config infra/apps.json --target windows-x64 --out /NEW/OUTPUT
bun infra/app-build.ts release apt --config infra/apps.json --receipt /NEW/OUTPUT/receipt.json --out /RELEASE.json
```

All standalone Bun artifacts use the compiler owned by Bun Libraries. Bun OS
keeps distribution planning, protected-input policy, source/runtime/native/asset
proofs, ABI checks, host locks, receipts and release staging. The build plan pins
the compiler repository revision and source hash; builds require its owned
checkout and compiler file to remain unchanged.

Compilation bundles JavaScript, rejects unresolved imports, disables build-time
environment inlining and executable dotenv/config autoloading, and embeds
explicit approved assets. The source graph and input checksums accompany the
artifact. Changed compiler, runtime or application inputs fail the build.

Native wrappers verify embedded payload hashes and materialize one cache
object per digest. Loader views use hard links, preserving dependency
filenames without copying blobs for each app. Arguments and streams pass
to the existing executable. The native owner retains responsibility for
system libraries, protected stores and application behavior.

A build receipt distinguishes binary production, ABI checks, runtime snapshot,
embedded dependencies, application execution and deployment. A release stage
contains content-addressed references. Edge/catalog publication owns routing
and release activation.

## Shared assets

```sh
bun infra/assets.ts plan --config infra/apps.json --out /ASSET-PLAN.json
bun infra/assets.ts upload --config infra/apps.json --plan /ASSET-PLAN.json --out /ASSET-RECEIPT.json
```

Only explicitly configured `assetRoots` are enumerated. Symlinks, protected
stores, credentials, provider sessions, datasets, game data and model weights
are excluded. Entry count, depth, object size and execution time are bounded.

Assets use `objects/sha256/<digest>` globally. App references contain paths,
content types and object identities; no object payload is copied under an app
prefix. The uploader checks immutable source bytes, uses conditional writes,
and verifies existing or newly written R2 content by SHA256. Public delivery
through the configured custom domain is qualified by the edge owner.

Credentials stay in the existing Cloudflare native store and environment.
Asset plans and release metadata contain no credentials or signed URLs.

Primary API references:
[Bun executables](https://bun.com/docs/bundler/executables),
[Bun S3](https://bun.com/docs/runtime/s3),
[R2 S3 operations](https://developers.cloudflare.com/r2/api/s3/api/).
The configured fork declarations and native CLI help govern available flags.
