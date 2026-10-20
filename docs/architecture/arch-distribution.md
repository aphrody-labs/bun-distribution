# Bun OS distribution architecture

Owner decision: 2026-10-16. This document defines the selected architecture and
its qualification boundaries. Source catalogues and forks are prepared inputs;
they do not establish a built, installed or bootable distribution.

Bun OS uses the Arch package model and **pacman/libalpm as its primary package
manager**. The distribution root owns source selection, package resolution,
build admission, shared caches, composition, images, signing and release. The
native Aphrody Bun fork remains the runtime owner. Existing APT/Debian/Ubuntu
inputs remain explicit conversion or compatibility references while the root
transitions its factory; they do not own the primary Bun OS image pipeline.

## Product compositions

All compositions come from the same pinned source and package graph. Availability
in the catalogue does not mean installation in every profile.

| Composition              | Selected capabilities                                                                               | Excluded defaults                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Server                   | Headless runtime, networking, storage, administration and explicit services; glibc primary          | Desktop compositors, display managers, Steam/Proton, gaming overlays and graphical first-run setup |
| Desktop                  | COSMIC session/compositor, selected greeter, portals, graphics, audio and Bun applications          | Automatic Omarchy session/defaults and gaming autologin                                            |
| Gaming                   | Qualified graphics/input stack, Gamescope session, selected Steam/Proton compatibility capabilities | Unrelated desktop services, upstream account/password defaults and automatic host repair           |
| Desktop session selector | One explicit COSMIC or Omarchy/Hyprland session owner attached to the Desktop composition           | Combining sessions or inferring a session from the distribution catalog                            |

The factory records `desktopSession` independently from `composition`. Server
and Gaming have no desktop session; Desktop defaults to COSMIC. COSMIC remains
unqualified pending an exact signed package closure and boot/display evidence.
Omarchy Hyprland is visible as an opt-in plan but blocked until its compatible
package subset and qualification exist. A blocked session cannot produce a
package lock or rootfs receipt.

Gamescope may also run nested for individual games inside a desktop. That is a
different target from its direct DRM/KMS gaming session. Its upstream documents
both modes and their graphics requirements; neither mode is qualified merely
by building the executable. [Gamescope source](https://github.com/ValveSoftware/gamescope/blob/2b5cf191d1047d6895516a834de8a72ac1c342f3/README.md)

COSMIC already declares separate desktop components, libraries and a toolkit;
reuse those owners and the distribution's existing pinned COSMIC/Material
contracts. A Hyprland configuration cannot implement COSMIC by renaming its
session or bindings. Additional sessions can be admitted as explicit choices
only with separate package, portal, greeter, boot and settings ownership.
[COSMIC components and packaging](https://github.com/pop-os/cosmic-epoch#components-of-cosmic-desktop)

Alpine/musl remains a distinct qualification target where useful. Its libc,
loader, toolchain and native ABI are not interchangeable with glibc artifacts.
The current `full`/`perf` selectors are not evidence that the Server/Desktop/
Gaming compositions and their dependency closures are already implemented.

## Reference decisions

These are Bun OS decisions derived from upstream mechanisms, not claims that
the upstream distributions share one architecture or release contract.

| Reference | Adopt                                                                                               | Adapt through existing owners                                                                                      | Reject                                                                                                                                      |
| --------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Arch      | Package/architecture metadata, pacman/libalpm, signed repositories and devtools clean-chroot builds | Resolve immutable repository snapshots, build dependencies and package receipts in the root graph                  | Live rolling state as a release identity; evaluating arbitrary PKGBUILD during read-only discovery                                          |
| CachyOS   | Complete custom recipe/kernel inventory and explicit optimization inputs                            | CPU tiers, scheduler/config/LTO and profiled optimization only for declared targets with workload evidence         | Native CPU autodetection for generic releases; silently merging divergent kernel fork networks; a second build queue                        |
| ChimeraOS | Gaming/input/package inventory and explicit persistence boundaries                                  | Image staging, exclusive deployment ownership and read-only system roots with separately qualified persistent data | Unreviewed FRZR bootstrap/unlock/repair, default accounts/autologin, automatic timers or upstream deletion expressions                      |
| Omarchy   | Complete package, build-tool, library, CLI and configuration reference catalogue                    | Optional desktop/hardware mechanisms after profile selection and native-runtime compatibility review               | Upstream installer/provision/reset/migration orchestration, live HOME seeding, provider/account templates and branding replacement          |
| SteamOS   | Separation of gaming-session experience, compatibility runtime and system-image delivery            | Whole-image updates and game/session qualification into Bun OS's own image/signature/activation contracts          | Treating SteamOS binaries, recovery media, proprietary Steam payloads or Deck-specific settings as a licensed generic Bun OS implementation |
| COSMIC    | Existing desktop/application/library source boundaries and toolkit owner                            | Arch recipes, runtime/Material integration and selected session/portal/greeter contracts                           | A second desktop toolkit copy or wholesale import of another distribution's host setup                                                      |
| Gamescope | Dedicated or nested game compositor as a selected gaming capability                                 | Root-managed Meson/native dependency recipe and graphics/input/HDR/display qualification                           | Treating it as the general desktop shell or enabling a gaming session on servers                                                            |

Arch's `makechrootpkg` builds a recipe in a clean chroot and accepts explicit
makepkg arguments. The root must own its configuration, package cache, working
copy and identity. [Arch devtools manual](https://man.archlinux.org/man/makechrootpkg.1.en)
CachyOS's pinned implementation separates source acquisition from the internal
chroot build; an internal `--skipinteg` does not waive prior source verification.
[Pinned clean-chroot implementation](https://github.com/CachyOS/devtools/blob/8f0d146f8aaeba77a52fbe5db48f1e21b28d8551/src/makechrootpkg.in)

CachyOS exposes scheduler, CPU, loaded-module/current-config and LTO choices.
The distribution records explicit inputs instead of inheriting the build host's
machine. [Pinned kernel recipe](https://github.com/CachyOS/linux-cachyos/blob/4a8d2ec8509d0da7d5fd5293f42251ea99d5ea3c/linux-cachyos/PKGBUILD)

FRZR describes read-only Btrfs deployments, separate `/home` and `/var`, and an
`/etc` overlay. These are useful persistence inputs; its README's atomic-update
claim is not a Bun OS boot, migration or database recovery receipt.
[Pinned FRZR contract](https://github.com/ChimeraOS/frzr/blob/4d15ebe4fdff0925691f6a1c2766af0c5ca26314/README.md)

Valve describes whole-system-image updates and recommends keeping application
installation separate from the read-only OS. The Steam Deck FAQ contains
historical launch information; it supplies a design reference, not current
kernel versions or a complete SteamOS build specification.
[Valve system-image guidance](https://partner.steamgames.com/doc/steamhardware/steamdeck/faq)

## One source, package and build graph

The root pipeline is:

`pinned sources -> authenticated package/dependency closure -> admitted build host -> kernel/system/runtime -> profile composition -> package/rootfs/image -> qualification -> signed release -> qualified activation`

The root source/Infra owners provision forks and register exact revisions.
Independent runtime, kernel, compiler, SDK and library histories retain their
source/license boundaries. Do not copy their implementation into product
`crates/`, `packages/` or `apps/` to suggest ownership has been consolidated.
Actual first-party moves require producer/consumer migration and removal of
verified duplicates; a flat manifest list or a different label is insufficient.

The three reference contributions are inputs to that graph:

| Catalogue                                           | Scope and entry point                                                                                                                                       |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [CachyOS](../../factory/arch/cachyos/README.md)     | All 183 custom package recipes and ten kernel variants; `integration.json` records devtools, kernel, CPU-tier and repository hooks                          |
| [ChimeraOS](../../factory/arch/chimeraos/README.md) | Direct image, builder, installer, graphics, input and persistence declarations; its planner reports unresolved dependencies and remains nonexecutable       |
| [Omarchy](../../factory/arch/omarchy/README.md)     | Eight package lists, all 185 packaging recipes, SDK/library/build metadata, configuration and CLI inventory; `integration.json` registers declarative hooks |

These counts describe the pinned custom sources, not complete binary repository
contents. Every recipe remains available, including build tools and libraries.
The resolver chooses a compatible closure for a specific target/profile; it
must not union alternative kernels, compositors, conflicting packages or every
optional application into one installed image. Package versions, dependency
classes, architecture, providers/conflicts, source hashes, signatures and
licenses remain attached to their recipe and selected repository snapshot.

Use `devtools`/`makechrootpkg` through the existing root bounded process and host
admission owners. Native Linux, explicitly selected SSH or Docker execution
may supply the qualified build context. Windows performs planning and source
inspection without starting WSL. No imported Dockerfile, shell installer,
dashboard or Rust frontend becomes another scheduler, cache or release owner.

## Kernel, Rust, SDK and library boundaries

Select one kernel composition per target/profile: source, patches, configuration,
modules, compiler/Rust/bindgen versions, CPU ISA, LTO mode and optional profiling
inputs. Reconcile Bun's acceleration changes with a selected kernel explicitly.
CachyOS, Omarchy platform kernels and Chimera/OGC source contracts are candidates,
not cumulative patches or interchangeable authenticated binary artifacts.
Kernel Rust remains owned by Linux Kbuild rather than an invented Cargo workspace.
The profile has no implicit kernel source: CachyOS, Arch and other kernel inputs
remain candidates until one source/configuration/ISA/artifact contract is
selected and qualified. The current `/usr` bootable path and Docker `bootable`
target are blocked on that gate; the gaming container uses its host kernel.

External Rust applications, compiler-facing tools and libraries retain their
Cargo manifests, workspace roots, lockfiles and declared feature/target policy.
Inventory every available recipe and source lock, but distinguish a locked
superset from the active build closure. Registry crates do not each require a
distribution Git fork. Upstream Git dependencies and submodules require exact
source identities; missing objects, mutable refs and unresolved expressions stay
visible. Native compilation remains serialized under the root build policy.

Classify SDKs/libraries by their actual contract: build-time compiler/tooling,
runtime/shared library, graphics/input/audio backend, desktop toolkit, service
client or AI/Infra capability. Reuse the selected Bun runtime, COSMIC/Material,
ALPM and library owners. An imported package requiring Node/npm/pnpm or another
language toolchain is a recipe compatibility issue to qualify; its presence
does not silently replace the native Bun runtime policy.

Bun OS integrates AI, Infra, Workspace and the runtime/system libraries through
their canonical implementation owners and one root product assembly. Protected provider
sessions, credentials, cookies, databases, models and datasets never become
distribution defaults or source synchronization inputs.

## Activation, licensing and evidence

Package-manager transactions, image construction and boot activation are separate
contracts. A read-only root or staged subvolume does not by itself make boot files,
shared `/etc`, service state and application/database migrations transactional.
Before enabling an updater, require authenticated complete artifacts, durable
boot selection, matching kernel/initramfs/modules, interrupted-activation behavior,
health receipts, storage admission and retained-data compatibility. No reference
timer or migration hook is enabled by catalogue registration.

Preserve per-component notices and source obligations: kernel and devtools licenses
differ; package recipes do not license their payloads. Omarchy/FRZR MIT notices do
not cover firmware or proprietary applications. Gamescope retains BSD notices,
including bundled-code notices; COSMIC components and libraries retain their own
licenses. Steam, firmware and commercial packages require explicit redistribution
contracts. [Gamescope notices](https://github.com/ValveSoftware/gamescope/blob/2b5cf191d1047d6895516a834de8a72ac1c342f3/LICENSE)

Record evidence in stages: repository/fork identity; verified source/archive and
patches; signed package snapshot and closure; host/toolchain/build inputs; hashed
package/image; boot/session/hardware qualification; signed publication; activation
health. A fork, lockfile, parsed catalogue, formatter result or build command
declaration advances only its own stage. This architecture document and the
reference inventories claim no new build, install, boot, deployment or release.
