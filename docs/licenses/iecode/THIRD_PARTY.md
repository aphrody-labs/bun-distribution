# IECODE third-party inventory

This repository versions the source and licensing notices required to build the IECODE
monorepo. Network-resolved dependencies remain declared in `Cargo.toml`, `package.json`,
`pyproject.toml`, `vcpkg.json` and `IECODE.sln`. Selected Rust emulator sources
and dependency sources remain under `crates/`;
see [`docs/upstream/README.md`](docs/upstream/README.md) for current ownership.
Bevy/wgpu forks, snapshots and engine tools are owned by the independent
archived GPU research and are not IECODE build inputs.

## Source and historical provenance inventory

Rows for absent console SDK and melonDS trees preserve historical provenance;
they do not imply those sources are currently shipped. The retained local native
sources are stb, bcdec, mio, TinyGLTF and the Lua 5.2.4 snapshot. Notice text in
headers is authoritative, including TinyGLTF embedded third-party notices.

| Location | Component | Notice/license | Integration |
| --- | --- | --- | --- |
| `crates/emu/core`, `crates/emu/render`, `crates/emu/cli` | Dust Nintendo DS emulator | [`docs/licenses/dust/LICENSE`](docs/licenses/dust/LICENSE); revision below | integrated emulator source |
| `crates/emu/core/src/rom` | ds-rom 0.8.0 | [`docs/licenses/ds-rom/LICENSE`](docs/licenses/ds-rom/LICENSE); revision below | integrated ROM API |
| `crates/emu/core/src/decomp`, `crates/emu/cli/src/decomp_cli` | ds-decomp 0.12.1 | [`docs/licenses/dsd/LICENSE`](docs/licenses/dsd/LICENSE); revision below | integrated analysis API and CLI |
| `crates/emu/ruzu` | Ruzu Switch emulator | [`docs/licenses/ruzu/LICENSE`](docs/licenses/ruzu/LICENSE); revision below | source snapshot pending workspace integration |
| `src/iecode-cpp/third_party/stb` | stb image codecs | license text in headers; attribution in `src/iecode-cpp/third_party/README.md` | CMake interface target |
| `src/iecode-cpp/third_party/bcdec` | bcdec block decoder | license text in header; attribution in the third-party README | CMake interface target |
| `src/iecode-cpp/third_party/mio` | mio memory mapping | MIT text in the source header | CMake interface target |
| `src/iecode-cpp/third_party/tinygltf` | TinyGLTF importer/exporter | MIT text in the source header | CMake interface target |
| `src/iecode-cpp/third_party/nds/blocksds` | BlocksDS Nintendo DS/DSi SDK and pinned subprojects | component-level upstream notices; revisions in `src/iecode-cpp/third_party/CONSOLE-SDKS.md` | historical snapshot; currently absent; excluded from host CMake |
| `src/iecode-cpp/third_party/3ds/libctru` | devkitPro libctru Nintendo 3DS SDK | upstream license in README and source headers; revision in `src/iecode-cpp/third_party/CONSOLE-SDKS.md` | historical snapshot; currently absent; excluded from host CMake |
| `src/iecode-cpp/third_party/3ds/citro3d` | devkitPro 3DS GPU library | upstream `LICENSE`; former `3ds/CONSOLE-SDKS.md` inventory is absent | historical snapshot; currently absent; excluded from host CMake |
| `src/iecode-cpp/third_party/3ds/citro2d` | devkitPro 3DS 2D graphics library | upstream `LICENSE`; former `3ds/CONSOLE-SDKS.md` inventory is absent | historical snapshot; currently absent; excluded from host CMake |
| `src/iecode-cpp/third_party/lua-5.2.4` | PUC-Rio Lua 5.2.4 C source snapshot | local `LICENSE`; no local `lua-src` fork exists | retained snapshot; excluded from host CMake; Cargo resolves registry `lua-src` |
| `src/iecode-cpp/emulation/melonds` (historical) | melonDS | parent `LICENSE` (GPL-3.0); revision below | optional checkout currently absent |
| `src/iecode-cpp/emulation/melonds/src/teakra` | Teakra emulator core | `LICENSE` and `README.md` | historical melonDS component; currently absent |
| `src/iecode-cpp/emulation/melonds/src/dolphin` | Dolphin components | `license_dolphin.txt` | historical melonDS component; currently absent |
| `src/iecode-cpp/emulation/melonds/src/fatfs` | FatFs | `LICENSE.txt` and `00readme.txt` | historical melonDS component; currently absent |
| `src/iecode-cpp/emulation/melonds/src/tiny-AES-c` | tiny-AES-c | `unlicense.txt` and `README.md` | historical melonDS component; currently absent |
| `src/iecode-cpp/emulation/melonds/src/net/libslirp` | libslirp | `README.md` plus upstream headers | historical melonDS component; currently absent |
| `src/iecode-cpp/emulation/melonds/src/blip-buf` | blip-buf | `license.txt` and `readme.txt` | historical melonDS component; currently absent |

For retained source, complete upstream text is kept beside its component or
under `docs/licenses/` for source merged into `crates/emu`. Do not replace a
notice with a URL-only reference: redistributions and offline builds must
retain the applicable terms. The redundant Git links were removed after
migration; their upstream repositories and pinned revisions are:

| Component | Upstream repository | Imported revision |
| --- | --- | --- |
| Dust | `https://github.com/electricazimuth/dust-cli.git` | `c5ccc036b8e9524aa1edba0b3b76d4dffbc1141b` |
| ds-rom | `https://github.com/DeathHound6/ds-rom.git` | `c3d7cd37165cd5cc6cbe3dbabf12bf1ae2a18c25` |
| ds-decomp | `https://github.com/DeathHound6/dsd` | `c4080635ac38aaf9608ca23751defa9fa19cf81a` |
| Ruzu | `https://github.com/vricosti/ruzu-emu.git` | `e3b740ac8f047004230f1f5cc3cfc99c78f7830a` |

The former root `ctru-rs` Git link was removed on 2026-10-01. It was not a
workspace member or a local path dependency; the former `crates/citro3d-rs` compatibility source also is absent from the current
checkout. This paragraph records historical provenance only. The removed link
pointed to `rust3ds/ctru-rs` revision
`9576b695897a7474829f490d696807b26a208747`.

## Generated verification

Run:

```sh
bun run check:licenses
```

The verifier checks that vendored files are tracked by Git, every declared component has a local
notice/readme, and the working tree has no untracked files hidden in a vendor directory. It does
not copy package-manager caches or build output into the repository.

Retained Gecko interpreter, image, debugger and GPU source are under
`crates/emu/wii`; the browser adapter is under `apps/web/wii`. Archive manifests
point to those owners instead of retaining duplicate source. The restored GPU
module root matches upstream blob `07af1ace1cf97c5ac95c26cb2b954f920c2ab889`
from `ioncodes/gecko` revision `da39be17b22eb7316e772d2369da15df3a52f7f0`.
Solstice IPL input is not included: its referenced source has no license notice.
Native callers provide their own `IECODE_GC_IPL_HLE` file explicitly.

## Current build and release boundary

The optional Linux Steam Client uses the Moby Docker Engine 29.1.3 default
seccomp profile with scoped `clone`/`unshare` rules for namespace combinations
that include a user namespace, plus mount-namespace-only calls for nested user
namespace work and the mount syscalls Bubblewrap needs. The kernel still
enforces namespace-local `CAP_SYS_ADMIN`; the container has no host
`CAP_SYS_ADMIN`. Its source is
`config/container/seccomp-steam-client.json`; the retained Apache-2.0 license
text is [`docs/licenses/moby-profiles-LICENSE`](docs/licenses/moby-profiles-LICENSE).
The custom AppArmor profile in `config/container/apparmor-steam-client` follows
Docker's default container policy and enables user and mount namespace
mediation for this service only.

`iecode-cpp-release` disables melonDS and engine/game; the optional melonDS
source directory is absent. A portable CLI/core release is not the combined
GPL melonDS emulator artifact. If a GPL emulator is incorporated later, retain
its source and all component terms listed above. The historical melonDS parent
revision is `906e9ebb27da8c6a715cd7abab4abfe8a8d29427`.

The active Wii/AArch64 portable packages are `crates/aphrody-wii` (GPL-3.0-only)
and `crates/aphrody-aarch64` (GPL-3.0-or-later), with local `LICENSE` files.
`crates/nie/aphrody-nie-data` inherits the private workspace source-rights notice
at `docs/nie/LICENSE`; it is not a public `ievr-data` crate. See
[licensing boundaries](LICENSES.md). No ROM, IPL, game dump, private key or
commercial game-data redistribution right is supplied by this inventory.

The root Cargo lock resolves `lua-src` 550.0.0 from crates.io. vcpkg feature
`iecode-cpp` supplies core dependencies; `engine`, `melonds`, `qt6` and
`native-display` are opt-in dependency groups. Package-manager license texts
remain with their resolved packages and must accompany applicable distributions;
caches are not vendored repository source. The archived GPU research remains
independent and is not an IECODE dependency.
