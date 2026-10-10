<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody and IECODE registry release evidence (2026-10-09)

The owner authorized publication of all Aphrody and IECODE producer packages,
including identity assets, and requires IECODE, NIE, Inagle and RG to use the
qualified Aphrody Bun fork and its owning packages. Repository visibility,
provider authentication, cookies, raw sessions and protected stores are separate
from package publication.

## Published npm snapshot

All 73 Aphrody producer versions are available from their canonical npm tarball
URLs. Registry SHA-512 values match the frozen release archives. A fresh consumer
outside every producer checkout installs all 73 packages, reinstalls with a frozen
lockfile, executes 16 consumed imports and runs three actual Workspace operations.
The exact versions, archive hashes, source snapshot and scoped gate limits are in
[the npm release receipt](npm-source-release-2026-10-09.md) and its
[machine-readable evidence](npm-source-release-2026-10-09.json).

IECODE consumes these exact versions from its root catalog:

| Package | Version |
| --- | --- |
| `@aphrody/agent-browser` | `1.0.0-canary.2` |
| `@aphrody/bun` | `3.3.11` |
| `@aphrody/canvas` | `1.0.9-aphrody.6` |
| `@aphrody/discord-kit` | `0.1.2` |
| `@aphrody/paths` | `0.1.3` |
| `@aphrody/runtime-sdk` | `0.1.3` |
| `@aphrody/sql` | `0.1.2` |
| `@aphrody/update` | `0.1.4` |
| `@aphrody/workspace` | `0.1.2` |
| `@aphrody/x` | `1.3.3` |

The nine libraries and Workspace also pass a separate clean registry installation,
frozen reinstall, 15 imports and three operations. Workspace's exported `./ops`
entry works without a producer checkout. An explicitly configured source owner
still takes precedence and retains its host-specific authority.

## Published Rust dependencies

The direct IECODE catalog uses exact registry versions:

| Package | Version | Qualification |
| --- | --- | --- |
| `aphrody-gpu-backend` | `1.0.0-canary.1` | Native package verification; WebGPU/WebGL WASM checks; strict WASM Clippy; Canvas/OffscreenCanvas API regression |
| `aphrody-web-crawl` | `1.0.0` | Serialized scoped checks, tests, strict Clippy and package verification |
| `aphrody-identity` | `1.0.0-canary.1` | Identity tests and package verification, original notices retained |
| `aphrody-softraster` | `1.0.0-canary` | Existing release content qualified |
| `aphrody-sprite-sheet` | `1.0.0-canary` | Existing release content qualified |
| `aphrody-ssh` | `0.1.0` | Config-selected endpoints, scoped tests and package verification |
| `bun-re` | `1.0.0-canary` | Main-agent native check/test/strict Clippy; registry tarball verified |
| `yolo-core` | `1.0.0` | Main-agent checks with `repository-tools`; verified registry tarball |

The required extraction, DOM/network/SSRF, SVG and M3-token transitive releases are
also published and downloadable. The dependency batch reports 755 Aphrody Rust
tests passing and two explicit runtime-prerequisite ignores. This does not qualify
every Rust member or every production runtime.

## Native IECODE setup and integration

- Cargo fetch and frozen Bun installation pass with registry dependencies. Both
  historical RE aliases resolve the published `bun-re` package. The six direct
  Aphrody libraries no longer require sibling Cargo paths.
- IECODE has 73 Cargo members and 32 local Bun members. The retained design
  submodule is unchanged; its published UI dependency is consumed through npm.
  Workspace, layout, script layout and crate-name gates pass.
- Setup does not copy sibling databases or resolve private game inputs by default.
  Operations select the installed verified Workspace package unless an explicit
  source checkout is configured. Native source/registry selection and isolation
  regression tests execute outside producer checkouts.
- CTR passes 17 unit tests and two real native C differential tests covering 320
  command cases, eight finalizations and 1,344 shader cases. Pinned reference
  excerpts retain their original license and provenance.
- Ten additional Rust leaves pass check/test/strict Clippy; some have no tests.
  Inventory/RE pass their registry-consumer gates, including 76 RE tests and one
  explicit ignore. A second ten-leaf qualification batch is in progress.
- The DS WebAssembly build and bindings pass on native Windows. Actual Chromium
  D3D12 renders three frames with the original top/bottom pixel assertions. This is
  bounded adapter evidence, not complete Nintendo DS emulation.
- Windows sccache exceeded the native command-line limit on the large `web-sys`
  invocation. Only the affected WASM gate processes opt out of the wrapper; global
  configuration and the shared Cargo mutex remain intact.
- Documentation archive packing now includes tracked documentation and retained
  cold archive evidence, with real 7-Zip preservation/exclusion tests. Ignored
  protected notes and untracked drafts remain outside the archive.

## Fork runtime contract

The qualified runtime is `1.4.3-aphrody.3`, revision
`d46f0ed6c69b3d945bbe9452d52e85231db02d0a`. Its JavaScript API reports the base
version `1.4.3`; the CLI exposes the fork suffix. Bootstrap and workspace gates
validate both the actual CLI identity and full selected revision. The contract is
stored in IECODE's `config/bun-runtime.json`; future runtimes need an explicit
qualification and contract update.

The fork's canonical type package is `@aphrody/bun-types 1.4.3-aphrody.3`.
IECODE preserves `types: ["bun"]` using a registry alias at `@types/bun` and
overrides official Bun type packages with the same exact owned producer. CI pins
the existing Aphrody Linux x64 artifact and verifies its version and revision.
The native Windows tests do not establish that the Linux CI workflow has run.

## Remaining publication work

The full Rust release is incomplete. The initial Aphrody inventory contained 168
members; the licensed Egui compatibility producer brings the current count to
169. IECODE has 73; source permission and declaration preparation do not
establish registry availability. crates.io returned HTTP 429 and permits roughly
one new crate name every ten minutes. Each publisher respects the returned retry
time and default package verification under the canonical Cargo mutex.

`bun-python-host 0.1.0` is published with its canonical self-contained header.
Main-agent native check, tests and strict Clippy pass. A qualified native CPython
3.12.15 runs the shared-interpreter and actual CLI subprocess tests successfully
after a test-only Windows exit-code expectation correction; the immutable 0.1.0
archive precedes that test correction. The runtime implementation is unchanged. Four owned
forks are being prepared for the existing SIMD/RFB patches and their transitive
Rio/VNC consumers; original library names, notices and behavior are retained.
The names already owned by upstream maintainers are not claimed as Aphrody IDs.

Wii's WASM gate exposed an upstream `egui-winit 0.36.2` native-file-drop implementation
compiled on WASM. A minimal licensed owner fork was qualified against exact
registry `egui 0.36.2`, using the upstream target guards and no fabricated drop
handler. The qualified `aphrody-egui-winit 0.36.2` is now published and consumed
through IECODE's exact root registry alias. Wii's native WASM build and actual
Chromium D3D12 fixture pass: four frames, the expected register/program counter,
and a real rendered canvas. Final web/NIE UI publication is a separate artifact
and corresponding-source qualification.

The DS build-time `arm-decoder` dependency is absent from crates.io, declares
`publish = false`, and supplies no license or permission notice in the pinned
source tree. Its locked Git revision remains explicit. The Object development
fork also remains an unresolved registry compatibility dependency. These limits
must stay visible rather than marking every package published.

## Reduced external data requirements

The owner also requested fewer mandatory external data inputs for NIE and Inagle.
Inagle defaults asset URLs to the current origin and selects PostgreSQL only with
an explicit data-source option. An inherited foreign-domain database URL no longer
activates a connection. Private game payloads and captured catalogues remain in
their isolated stores; absence is not evidence of complete game content.
NIE now validates optional editorial manifests rather than compiling private
catalogue inventories into the crate. Its scoped native tests pass 78 cases;
ten private catalogue parity tests remain explicitly ignored. Inagle's selected
SQLite service, text and CPK APIs pass 38 focused tests and 141 assertions.
Source and registry qualification remain separate.

## Isolated IECODE storage

IECODE's shared storage launcher uses the resolved Aphrody `ie` profile. It
prefers installed/indexed game VFS, otherwise qualified IE-owned Docker
PostgreSQL, otherwise a ready existing SQLite game mirror. Explicit selections fail when
unavailable. Aphrody metadata SQLite and foreign provider/database URLs are not
game-source candidates. PostgreSQL container health alone does not qualify an
empty game database.

On the current Windows host the real 180,142,080-byte local game mirror passes
integrity, required schema and nonempty-data checks and is selected as SQLite.
The native IECODE DLL builds and loads through the qualified Bun fork; no indexed
installed game is found, so complete game VFS mounting is not claimed.
Storage setup and backup operations are scoped to new IE-labeled Docker
resources, immutable PostgreSQL/Bun images and isolated profile runtime secrets.
SQLite backups use consistent snapshots and verify integrity and SHA-256 before
read-only Docker mounting. Existing Aphrody containers and DBFR production
resources are preserved. No restore or provider-memory synchronization is
implicit in this storage setup.
