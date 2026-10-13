# Session report: 13 October 2026

## Scope and result

This session prepared the Bun OS distribution, corrected Material ownership,
established an authenticated Ubuntu build factory, built a Windows package
conversion frontend, and attached the application's public hostnames.
The complete OS objective is not achieved.

Native Windows owns workstation development. The VPS factory is a separate
SSH/Linux execution context. No workstation WSL was started. Source owners,
runtime bytes, packages, desktop, rootfs, images, WASM, performance and public
routing are qualified separately below.

The latest owner request authorizes consolidation/reporting and normal
publication of our owned batches. This report does not revive unrelated
earlier convergence work. Final consolidation repeated the scoped compile
checks and rebuilt/executed apt.exe. No new behavior tests were authored or run.

## Ownership and source graph

Distribution assembly lives in this checkout. Bun remains the canonical
runtime fork on main. Material owns the existing native token/control engine,
libm3 and WASM adapter; it retains its web package submodules. Linux, WSL,
WSLg, the WSL kernel, COSMIC and official APT remain distinct sources with
their own histories and licenses.

The final source lock contains **83 mounts, 77 repository/revision pairs and
74 gitlinks across nine roots**. The original four-root audit had 78 mounts
and 71 pairs. Different revisions of libcosmic/iced/icons remain separate
mounts; deduplication does not collapse version-specific topology.

| Root | Locked revision |
| --- | --- |
| Bun | c209b95eb0dcc964745f4684f127abb83cbe2697 |
| Material/os | 1e65a503420e4a8962b8ceaa18819eedbc280454 |
| COSMIC epoch | cfa498958dc8aeac73aa911cbd318c01e47ac957 |
| libcosmic/os | 7f715bc5d2d383a070fd8c760aa52c5627df96b6 |
| Linux aphrody-bun | 47f637c546bf4bb274c7149815ed66d748e4f325 |
| WSL master | 341f1ddf76f089ff6351590b03f92bad30041725 |
| WSLg main | 6942bb534b537302a7a22617261d9274db3cfa37 |
| WSL kernel aphrody-wsl-6.18 | e5043002ed6f0b0eb17a0fb9efafa794045853ed |
| APT main | 745fc126218c7cb3df48b22bbc7c7098fa2f7966 |

The APT GitHub mirror used initially was archived. The owner fork was then
fast-forwarded from official live Salsa main, normally pushed and checked by
remote ref. That Git source is distinct from Ubuntu's authenticated apt 3.2.0
source package.

Source export now has one owner, exportPinnedSources, reused by the existing
assembler. It implements committed Git/tree/blob checks, recursive gitlinks,
archive bounds, LFS SHA256/size verification, protected-root guards, fresh
outputs, shared locking, and measured byte/inode capacity requirements.
No complete source acquisition/LFS/export receipt exists yet. Large icons
trees need measured capacity and a complete inventory, not a truncated API tree.
Automatic approval review rejected deletion of the transient icons metadata
with "blocked by policy". No deletion or bypass occurred; that ignored
metadata store remains in place.

References: [source lock](../sources.lock.json),
[source export](SOURCE-EXPORT.md), [native targets](NATIVE-TARGETS.md).

## Material correction sequence

1. The initial OS-local libm3 and 2061-byte scalar ABI 1 were a duplicated
   baseline contract. Their successful execution did not qualify the corrected
   native owner. That ABI 1 result is superseded.
2. libm3, libm3-wasm and the typed Bun loader moved into Material. The existing
   native token engine and framework font descriptors became the source owner.
   libm3 consumes its colors, typography, shapes, motion, state and adaptive
   breakpoints. Role order is shared through the no_std native role type.
3. The corrected no_std/std facades and native Windows COSMIC adapter compiled
   against libcosmic/os 7f715bc5. The custom theme scope covers inherited controls
   and overlays; there is no displayed GUI or complete component proof.
4. Dynamic scalar **WASM ABI 2** was built from published Material/os
   ce47e50324ce4053c4fcd08be59db55254e231f7: **113528 bytes**, SHA256
   **c1abee38ea03c33b8150c14ef987906759182a6fd693c636b960922962c69ed8**.
   It executed with no host imports, 49 native role names and nine variants.
   A green seed changed Primary from ff65558f to ff1f6a4e. Widths 599/840/1200
   returned navigation bar/collapsed rail/expanded rail.
5. The richer existing M3 controls were transferred from clean Aphrody source
   96e732f1c17591389e5bb6d2dc51cb9596edff72 to Material/crates/m3. Provenance
   records 23 original Rust inputs. Native/default, no-native and WASM checks
   initially passed before formatting. Nineteen Rust files were then normalized
   with upstream default rustfmt; original and current hashes remain recorded.
6. libm3 std now re-exports the existing component, accessibility, forms, focus,
   keyboard and composition owners. Final normalized compile gates passed:
   native CPU 4.68 s, no-native 1.74 s, COSMIC/MSVC 0.88 s and WASM no-native
   4.62 s. The independent no_std libm3 gate passed in 0.47 s. Complete metadata
   resolves 217 packages and one local token 1.4.4 owner; the earlier filtered
   graph had 197 packages. No unit tests or displayed GUI were run.
7. Final Material/os consolidation **1e65a503420e4a8962b8ceaa18819eedbc280454**
   was normally pushed and independently verified by remote ref. The OS lock
   now pins it. It contains the 79-source-hash native consolidation receipt.
   The public scalar WASM remains the exact earlier ce47e503 artifact; no fresh
   scalar artifact from 1e65a503 is claimed.
8. Three unqualified Aphrody consumer manifest changes were reverted exactly.
   Its Cargo.lock stayed unchanged. Original 106 token and 24 richer M3 files
   remain clean/hash-identical and retained until the consumer acquisition,
   lock and execution gates qualify. A local token crate package exists, but
   registry publication/authentication and packaged consumer gates are incomplete.

Remaining Material work includes native web dynamic-color/MCU classic/HCT
bindings, complete component coverage, actual GUI display, full desktop/platform
behavior, original consumer migration and a final scalar WASM artifact.

Evidence: [Material transfer receipt](https://github.com/aphrody-labs/material/blob/1e65a503420e4a8962b8ceaa18819eedbc280454/crates/m3/transfer-receipt.json),
[native consolidation](https://github.com/aphrody-labs/material/blob/1e65a503420e4a8962b8ceaa18819eedbc280454/docs/native-consolidation-2026-10-13.json),
[scalar execution](../out/wasm-material/wasm/execution.json).

## Ubuntu source factory and storage

### Authenticated sources

The VPS retrieved apt **3.2.0**, dpkg **1.23.7ubuntu1** and livecd-rootfs
**26.04.35** directly from official Ubuntu resolute archives. Isolated APT
lists/cache/temp were under the selected build filesystem. The chain is
signed InRelease, authenticated Sources SHA256, and every verified DSC/tar.
Native apt-get, dpkg-source and Ubuntu keyring checks remained intact.

All three source packages were extracted. Missing detached developer keys
for dpkg/livecd-rootfs were recorded separately; Ubuntu archive authentication
remained verified. No global APT list configuration or host package installation
was performed.

Evidence: [source receipt](../out/ubuntu-source-receipt.json).

### Guarded cleanup

The remote batch reclaimed **50,080,063,488 observed bytes** across 12
allowlisted disposable classes and stopped after meeting the 50 GB threshold.
The measurement sums each successful operation's positive filesystem delta;
it does not credit concurrent restoration/source writes or promise permanent
free space.

At its final 09:22 UTC snapshot, the build filesystem had 128,892,571,648 bytes
available and root had 2,562,670,592. Later concurrent writes changed root
availability. Factory work therefore kept engine data, exec state, PID, socket,
logs and temporary files on the build disk, under the shared heavy lock.

The cleanup stopped no processes and deleted no Docker images, containers or
volumes. Factory sources and the active Shenron restoration were excluded.
It was an SSH VPS operation, not workstation media cleanup.

Evidence: [cleanup receipt](../out/factory-cleanup/receipt.json).

### Real toolchain and package artifact

A dedicated build-disk Docker engine built a real Ubuntu 26.04.1 toolchain:

- Image: sha256:03f3e7a691e043f87b5b3b64169ad762b705e973a9b0c65f901a22364f9bbb68.
- Base: ubuntu@sha256:f144425ff09be612d6d9ad965196e9cdc23dae1f42110a8a11a3e9a8198759f7.
- glibc 2.43; sbuild 0.91.2ubuntu3; mmdebstrap 1.5.7-3; uidmap
  1:4.17.4-2ubuntu3; live-build 3.0~a57-1ubuntu54; livecd-rootfs 26.04.35;
  germinate 2.49 and debian-cd 3.2.3.

A fresh clean sbuild unshare chroot then built livecd-rootfs 26.04.35 for amd64:

| Artifact | Bytes | SHA256 |
| --- | --- | --- |
| livecd-rootfs DEB | 148762 | 7e12304e4bdcbd33526e28d7b6c1efa6e06b334a474bb58b3be476c60a89a836 |
| clean resolute chroot tar | 475487744 | a3b18a29a32571c02fbeef1ea52a390b8bf3126b6b98493f89ccbd02ea3646bb |

The package job ended with exit 0 and released its locks. Build options were
parallel=2 nocheck; no upstream test commands were reported. Diagnostics
recorded absent /dev/console and failed /proc mounting. This successful DEB
does not qualify a distribution rootfs, ISO, desktop, boot or complete/perf image.
The engine is a bounded factory execution context, not the persistent
deployment/runner daemon.

Evidence: [toolchain receipt](../out/ubuntu-toolchain-receipt.json),
[package receipt](../out/ubuntu-package-receipt.json).

## Exact runtime and Windows package conversion

The selected Windows Bun is PE64 x64, **171403264 bytes**, SHA256
**a6f79203a9601914e86479f103c7f695330d54442169566f64e29328440d9c89**.
It reports Bun.version 1.4.4 and revision
**2ae8fc65fba1d05c423a2433b1195835109942b6**. Its reported release URL is
provenance metadata only. Stable release archive authentication and the complete
native runtime suite were not established.

The locked OS Bun source is **c209b95eb0dcc964745f4684f127abb83cbe2697**.
These revisions differ. Same-machine app compilation/execution is qualified;
staging this binary as the exact locked OS runtime is not.

The single app compiler reuses native Bun.build/embeddedFiles, the canonical
bun-cloudflare R2/authentication owner, shared content identities and existing
PE/ELF/GNU loader inspection. The APT build command is a thin adapter with its
own actual version-contract execution gate.

The final consolidated Windows apt.exe is **171469824 bytes**, SHA256
**43cacda8663021aa0640297978ef600b0d43bf8fe715d04a0f5464ee96bb2fbd**,
with 16 hashed source inputs. It executed its native version contract and:

- Converted the authenticated Ubuntu apt 3.2.0 DSC source contract.
- Inspected its authenticated source archive with 926 entries.
- Converted the original MSYS2 UCRT zlib 1.3.2-2 archive as a native DLL package.
- Emitted an actual portable WinGet manifest; native WinGet validation passed.

The zlib archive matched the primary MSYS2 publisher SHA256
841401182976d2f9e17e5c0ebaac51f2a8014140ea53d67625e91c8fb3c85ea0.
Extracted zlib1.dll retained its bytes: **127291 bytes**, PE64 x64 library,
SHA256 **11cd91171765cd65f1c3362e3df67e5f5a618a6b88c8cdec899b802eaf1c7b0d**.
Its imports resolve to Windows system owners. Detached MSYS2 signature trust
and DLL execution were not qualified.

The bridge has no native libapt installation engine or transaction backend.
The source APT version and bridge/runtime version remain distinct.
The matching WinGet installer URL now serves the exact release artifact over
the dist.aphrody.app custom domain, with public bytes and SHA256 verified.

Gzip and bounded Zstandard use runtime APIs. XZ/bzip2 require an explicitly
selected native 7-Zip executable, including the actual APT .tar.xz inspection.
That external decoder remains part of the source-inspection dependency contract.

The final build uses the current 1e65a503 Material source lock and app catalog;
its native version, source/DLL conversions and WinGet validation passed.
It supersedes the earlier 994dd5f2 artifact. Conditional R2 publication created
one content-addressed object. Public HTTPS retrieval returned HTTP 200,
171469824 bytes and the exact SHA256, with an immutable one-year cache policy.
The result qualifies public artifact delivery, not the native libapt engine
or every application behavior.

Public artifact: [apt.exe](https://dist.aphrody.app/objects/sha256/43cacda8663021aa0640297978ef600b0d43bf8fe715d04a0f5464ee96bb2fbd).

After those replacements were publicly verified, three obsolete owned output
files were removed with exact path, regular-file, size and SHA256 guards:
the two earlier apt.exe builds and the 2061-byte ABI 1 module. This retired
342936589 bytes of generated release files. Historical receipts remain.

Evidence: [runtime snapshot](../out/runtime-current/windows-x64.json),
[consolidated APT build](../out/apt-consolidated/receipt.json),
[conversion qualification](../out/apt-consolidated/qualification.json),
[public release proof](../out/apt-consolidated/public.json),
[committed artifact summary](ARTIFACTS-2026-10-13.json),
[app build contract](APP-BUILDS.md).
Primary MSYS2 proof: [publisher package page](https://packages.msys2.org/package/mingw-w64-ucrt-x86_64-zlib?repo=ucrt64).

## Applications, Cloudflare and shared R2

The inventory covers 14 native engine CLIs plus APT and Desktop. No duplicate
Cloudflare, S3, content digest or executable-ABI implementation was added.
Only explicit public asset roots are enumerated; provider/session/game/model
stores are excluded. Missing native artifacts fail qualification, including
Artcraft's unresolved executable owner. Desktop still has external workspace/
native-engine context. Other target runtime snapshots and Mach-O inspection
remain unqualified.

Cloudflare MCP created all **16 enabled Custom Domains** on the existing
**aphrody-app** Worker, with previews disabled. A fresh read-back checked each
domain and managed proxied DNS record. Public DNS resolved for every hostname;
all 16 returned **HTTPS HTTP 200 with certificate validation enabled**.

The homepage remained HTTP 200 and www redirected to it. Existing root/www
domain IDs and assets/dist R2 records were preserved. The Worker's modification
timestamp stayed unchanged; no Worker code was uploaded. These hosts serve
the existing public edge response, not independently deployed native apps.

At the recorded 11:13 UTC certificate observation, 11 new dedicated packs were
active and five pending_validation: Lightcraft, Gridcraft, Figcraft, APT and
Desktop. Existing wildcard coverage already made public HTTPS valid. No
long sleep/retry loop or certificate bypass was used.

The Material ABI 2 object was stored once under objects/sha256/<digest>.
The native R2 path verified source and remote SHA256; public retrieval returned
HTTP 200, 113528 bytes and the same digest. A second conditional upload returned
created=false and verified the existing object. This proves one shared WASM
object and does not claim all application assets have been uploaded.

Public object:
[Material ABI 2 WASM](https://assets.aphrody.app/objects/sha256/c1abee38ea03c33b8150c14ef987906759182a6fd693c636b960922962c69ed8).

Evidence: [domain receipt](../out/app-domains/receipt.json),
[domain contract](APP-DOMAINS.md),
[R2 upload](../out/wasm-material/wasm/r2.json),
[public delivery](../out/wasm-material/wasm/public.json),
[deduplication](../out/wasm-material/wasm/dedup.json).

## Deployment control and workflow preparation

The prepared Rust control-plane profile uses Komodo Core/Periphery 2.3.3,
FerretDB 2.7.0 with PostgreSQL DocumentDB, Forgejo 15.0.10 and Runner 13.2.0.
Six exact OCI image digests and upstream provenance are recorded.
MongoDB was excluded for the observed kernel compatibility limit; the official
FerretDB integration was selected instead. Native JSON/YAML parsing and the
Compose template validation passed.

No image layers were pulled by this deployment-profile batch. Persistent
deployment/CI Docker contexts, authenticated service health, first admin,
forge/runner registration, native job image and live workflows are unqualified.
The factory daemon and existing production/global Docker contexts are not the
deployment owner. No private control/backend listener was exposed.

Evidence: [control-plane profile](../infra/control-plane.json),
[deployment contract](DEPLOYMENT-CONTROL.md).

The [Rust systems catalog](RUST-SYSTEMS.md) verifies canonical package names,
allocator locking, no_std/alloc feature boundaries and the current native versus
future bare-metal architecture. It adds no dependencies or new runtime claims.

## Gates, coordination and publication

Native Bun source gates passed after app integration: check covered 28 files,
scoped lint had no warnings, and format checks passed. Root later extended its
lint/format scripts to cover infra. Material compiler gates are listed above;
no new behavior tests were authored or run. Existing upstream test sources
were preserved during the owner transfer. A compile check, scalar execution, source DEB,
DNS/TLS probe and template validation have their stated scopes.

A separate thread reported workstation episode deletion. New heavy jobs were
temporarily suspended while our command payloads were checked; none targeted
those episode paths. A shared app-server PID does not identify the responsible
task. Our cleanup covered the explicit SSH VPS batch and the three guarded
obsolete release files above. No protected .local/provider/media deletion or
recovery was performed by this batch.

| Publication | Verified state |
| --- | --- |
| APT owner main | 745fc126218c7cb3df48b22bbc7c7098fa2f7966, normal push/ref verified |
| Earlier Material/os | ce47e50324ce4053c4fcd08be59db55254e231f7, source of public ABI 2 WASM |
| Final Material/os | 1e65a503420e4a8962b8ceaa18819eedbc280454, normal push/ref verified |
| Bun OS source consolidation | 2e413aa6d9c9f5cd6eeb6773c7b903c3929b3edb, normal push/ref verified |
| Final reporting update | This report's Git revision; publication checked after commit |
| Original Aphrody consumers | Migration deferred; unqualified manifest changes reverted |
| Registry token crate | Local package only; publication not qualified |
| Native apps/control/forge | Not deployed |

This report belongs to the consolidation batch. Its commit identity is obtained
from the repository's Git log, rather than embedding a self-referential SHA.
Ignored out receipts contain local/VPS execution evidence and are not silently
published with documentation.

The source batch contains 65 files and 11621 inserted lines. Material's final
consolidation contains 39 changed files, 7860 inserted and 24 removed lines.
Both were committed as aphrody-dev <contact@aphrody.com> and pushed normally.
Material's concurrent untracked submodule work was retained. Original Aphrody
consumer changes from this batch were reverted; unrelated concurrent changes
and protected stores were excluded from staging.

## Unresolved objective

Complete source export/LFS/capacity proof; the source-matched OS Bun runtime;
complete COSMIC/libcosmic and hardware boot; distribution rootfs/full/perf
images; native Windows libapt and package transactions; complete conversion and
compression/runtime dependency closure; final Material web/native GUI and
consumer migration; remaining standalone apps and cross-target ABIs; live
control/forge/runner deployment; full Bun/JSC/desktop WASM; performance
measurements; and identification/integration of **9937-389B** remain open.
