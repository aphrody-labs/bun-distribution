# Official Omarchy guest source provenance

This image's preferred full-rootfs input is the official
[`omacom/try-omarchy-windows` v0.12.0 release](https://github.com/omacom/try-omarchy-windows/releases/tag/v0.12.0).
The local checkout is pinned at commit
`3b497519f5f4b320b33aa7bfaf8e3ec12ecb2b64`. Its
`guest-build/source.lock.json` pins the guest builder
`jorge-huxley/try-omarchy-win` at commit
`aa009bd828037727de212c1412ccbe6ed7c95c7b` on branch `win`.

The release guest manifest SHA-256 is
`686f04a58e65d9dfdf36dd66c2dd75778ff5524a49be6952f242bc5e1e30a1a3`.
The signed package lock SHA-256 is
`c4519a9e974feba651ab3175e5c0c0083bae50ef89febf129bc27a4014ea41a6`.
Those digests were verified against the downloaded files in the owner-managed
VPS source cache. The manifest identifies Omarchy upstream commit
`c668141e9c42b13c80c9ca4ea108e11708c5e8a5`, release 4.0.4, package release 10. This matches the stable recipe pin used by the existing package-only
candidate. Do not substitute the separate `quattro` manual checkout.

The official release root filesystem is `rootfs.ext4.zst` at
[`https://github.com/omacom/try-omarchy-windows/releases/download/v0.12.0/rootfs.ext4.zst`](https://github.com/omacom/try-omarchy-windows/releases/download/v0.12.0/rootfs.ext4.zst).
Its compressed size is 1,859,964,893 bytes and SHA-256 is
`2f329e53b92c994e744b4d2311b0cd900552cd54c4efee5736c1a6e374a76864`. The
expanded ext4 image is 7,516,192,768 bytes with SHA-256
`466995346cff00614e695e5dddb8576d654b8629fc332eb7e588e889ad71bd3d`.
The owner-verified lock records graphics package versions including
Hyprland `0.56.2-4`, Mesa `1:26.2.4-1`, Quickshell `0.3.2-1`, and
`vulkan-virtio` `1:26.2.4-1`. Use the lock and manifest as the authoritative
whole-package inventory; this short list is only a provenance cross-check.

## Import constraints

The root-owned import helper should verify both release metadata digests and
the expanded filesystem digest before use. Import the ext4 read-only, preserve
numeric ownership, modes, symlinks, hard links, ACLs, extended attributes,
capabilities, and timestamps when archiving its contents into a Docker layer.
Do not run the upstream disk installer, execute guest build scripts inside
the import, copy Windows launcher patches or user data, or claim the import
as a Bun OS `/usr` closure. Keep the official guest manifest and package lock
alongside the image receipt so qualification can trace the full rootfs.

The official guest kernel and initramfs are separate assets suitable for a
native QEMU/KVM browser-desktop fallback. container2wasm is a distinct
conversion route; c2w v0.8.4 has a separately pinned binary and source
provenance in [NOTICES.md](NOTICES.md). Its documented GUI limitations mean
that a c2w graphical desktop remains experimental and must not be advertised
as supported without a successful end-to-end browser qualification.
