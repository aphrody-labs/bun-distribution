# ChimeraOS source integration

This is a declarative input to the single Bun OS factory. Import
`planChimeraOs({ target: "linux-x64", archiveDate, kernelOciDigest })` from
`./index.ts` in the root Arch/Pacman planner. The module returns package inputs,
source identities, persistence contracts and blocking gates. It executes no
commands and always reports `executable: false`, `qualified: false`, and
`ready: false`; supplying a date or digest does not qualify an artifact.

The root owns package resolution, source export, target/profile selection,
shared build/cache locations, image assembly and release receipts. There is no
second image pipeline here. No services, user services, installer, boot updater,
upstream deletion expressions or rootfs overlays are automatically activated.

## Inventory boundary and provenance

`catalog.json` preserves every direct declaration in the pinned upstream image
manifest: 159 repository packages, 42 AUR package bases, three local PKGBUILDs,
16 system services and five user services. It additionally records all 16
explicit builder packages, two builder AUR tools, two bootstrap packages,
30 installation-media packages, installer build prerequisites, all 63 tracked
rootfs files, Chimera Python requirements, Gamescope pkg-config dependencies,
Mesa/lib32-Mesa recipe dependencies and the Rust manifests/locks of the gaming
capabilities. These are complete direct source lists, not an invented resolved
binary dependency closure. Base container dependencies remain unresolved.

The three Rust lockfiles contain 344, 195 and 197 package records respectively.
Their registry package versions/checksums and six Git package records are
recorded separately; counts are per owner and must not be summed as unique
packages. Versions describe the observed source locks, not installed packages.
InputPlumber, PowerStation, opengamepadui-core, reaper and docgen retain their
external source ownership. No product crate is added to the root workspace.

`sources.json` contains 17 immutable repository revisions, source-file Git blob
identities, seven Gamescope gitlinks, two Meson wraps and the complete returned
17-repository ChimeraOS organization inventory. Its source/fork list is the
exact handoff to the root Infra owner; `not-provisioned` is intentional. Six
OpenGamepadUI `.gitmodules` declarations have no corresponding gitlink in its
selected tree; they are marked stale and receive no fabricated revision.
Archived implementations, game data and unlicensed reverse-engineering binary
payloads are excluded. No remote was mutated and no fork or submodule was added.

The current image manifest selects `linux-ogc` from
`ghcr.io/opengamingcollective/kernel-packages-arch:latest`. The observed OGC
source and packaging commits do not authenticate that mutable artifact. A
digest, signed artifact receipt and source/config/patch parity are required.
The older `linux-chimeraos` recipe instead selects `v6.14.9-chos1`, resolved to
`aa6c964544199c283c9e79a5f2c4b7fad572c0ef`; it is a separate historical reference,
not the current kernel. No ChimeraOS Rust compiler fork was found in the
organization inventory. Linux Rust support uses Kbuild, not a root Cargo merge.

ChimeraOS-specific Context7 resolution returned unrelated products and was
rejected. Arch Linux Wiki Context7 references were used for package signing,
the Arch archive and makepkg reproducibility. Repository facts come from pinned
official GitHub MCP metadata, full non-truncated trees and source files.

## Adopt, adapt, reject

| Upstream contract                                                                                    | Decision for Bun OS                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explicit package lists, multilib graphics/input stack and hardware quirks                            | Adopt the complete inventory; resolve all versions, transitive dependencies, source licenses and signatures through the root Pacman owner. Review overlays individually.     |
| Pacstrap/chroot, makepkg, Btrfs send image, package manifest and checksum receipts                   | Adapt as root graph inputs and build requirements. Do not execute the upstream Dockerfile or build-image script as another pipeline.                                         |
| Read-only Btrfs deployment roots; persistent `/home` and `/var`; writable overlay `/etc`             | Adapt as a data contract. Keep credentials, sessions, databases, models and datasets in their existing protected owners. Migration requires explicit compatibility evidence. |
| FRZR separate receive/staging subvolume and exclusive `flock`                                        | Adapt staged deployment and exclusive ownership. Verify signatures, available storage and complete artifacts before root-owned activation.                                   |
| OGC kernel packaging, optional historical Chimera kernel/Mesa patches, Rust input/power/Godot owners | Retain independent pinned source/license/build contracts; reuse qualified canonical runtime/graphics owners before adopting divergent forks.                                 |
| FRZR boot timer and daily automatic downloads                                                        | Reject automatic activation: `frzr-autoupdate.timer` runs five minutes after boot and daily upstream. Neither it nor `frzr-deploy` is enabled here.                          |
| `frzr-bootstrap`, `frzr-unlock`, implicit repair and cleanup                                         | Reject automatic invocation: bootstrap formats disks, repair deletes deployment/boot/overlay state, and unlock mutates the running root and package database.                |
| Upstream default user/password/autologin, passwordless sudo, arbitrary migrations and download hooks | Reject defaults. Root host identity, permissions and reviewed migration contracts remain authoritative.                                                                      |
| Mutable yesterday archive, latest container/kernel tags, AUR Git heads and SKIP checksums            | Reject as release identities; require immutable source/package/artifact resolution.                                                                                          |
| Upstream removal of docs/manpages, package caches, build tools or persistent package state           | Reject automatic deletion. Root build/cache/data owners decide lifecycle. Retain license notices.                                                                            |

## FRZR atomicity and persistence limits

[FRZR README](https://github.com/ChimeraOS/frzr/blob/4d15ebe4fdff0925691f6a1c2766af0c5ca26314/README.md)
describes read-only Btrfs deployments and persistence. The pinned
[`__frzr-deploy`](https://github.com/ChimeraOS/frzr/blob/4d15ebe4fdff0925691f6a1c2766af0c5ca26314/__frzr-deploy)
receives a new image into another subvolume, copies kernel/initramfs/microcode
to the ESP, rewrites the boot entry, then runs image-supplied migrations and
hardware tweaks. It removes one older deployment while retaining the running
and next-boot deployments. These are upstream behaviors, not operations this
integration performs.

An isolated read-only root does not make every step a transactional update:
the boot entry is directly rewritten, cleanup precedes staging, migration hooks
can mutate shared data, and the digest check for an OCI payload is not an
independent publisher-signature policy. Local image paths bypass that OCI
digest branch. Upstream does not establish a Bun OS boot-health receipt or
database/schema rollback contract. `/etc` shares a persistent upper layer, so
retaining `/home` and `/var` alone is insufficient compatibility evidence.

The root deployment owner must explicitly qualify complete receive/staging,
trusted image identity, boot-file durability, kernel/initramfs matching,
interrupted activation, space/inode limits, retained user data, `/etc` overlay
compatibility and application/database schema migration before activation.
This directory does not implement those destructive operations or claim that
their host/boot gates passed. Native Windows can inspect this plan; actual
Linux/Btrfs/UEFI, SSH or Docker qualification remains host-specific.

License expressions are scoped to their source owners, not to the entire
distribution. MIT notices for the derived manifest and FRZR description are in
`NOTICE.md`; kernel, Mesa, firmware, AUR and resolved binary-package notices
remain separate release gates. In particular, xonedo firmware declares a custom
license and Microsoft's terms; recording its recipe does not redistribute it.
