# Bun OS Omarchy image inputs

The preferred Docker source is the official, signed-package-lock Omarchy
guest root filesystem from `try-omarchy-windows` release `v0.12.0`. This is a
complete upstream Omarchy rootfs, not a pacman-resolved partial candidate.
The exact release identity, package versions, asset hashes, and safe import
requirements are recorded in [SOURCE-PROVENANCE.md](SOURCE-PROVENANCE.md).
[`guest-inputs.json`](guest-inputs.json) and [`import.ts`](import.ts) now
implement the bounded, digest-verified ext4 import, including a metadata
receipt and generated Dockerfile. The root image builder still needs to invoke
the helper on the VPS under its shared factory lock and build the generated
`import.Containerfile`; no imported image has been built or qualified yet.

The generated Dockerfile exposes `imported-rootfs` and `c2w-terminal` targets
with `/bin/bash --login`. The c2w target is shell-only. The official release
also provides the Linux kernel and initramfs for a separate native QEMU/KVM
browser-desktop fallback; that guest launch path still requires factory
integration and qualification. The c2w conversion is a distinct experimental
target and does not imply that c2w supports a graphical desktop.

## Package-resolved candidate (superseded as the preferred input)

This earlier path is an explicitly unqualified source-candidate image built through the
root image factory from signed Arch/CachyOS and Omarchy pacman repositories.
It installs stable Omarchy 4.0.4 settings plus a deliberately small Hyprland
desktop package selection. Build-time `pacman -Q` output is retained inside
the image as a diagnostic receipt; it is not an immutable package lock or a
release receipt. This is not a full Bun OS `/usr` composition.

The `desktop` target starts the package-installed Omarchy Hyprland bootstrap
as an image-local non-root account, using a temporary XDG home and a small
`~/.config` override. It does not import a host home, copy `/etc/skel` into a
live home, run the Omarchy disk installer or migration, or enable host
services. Current Hyprland's documented `AQ_NO_KMS_REQUIREMENT=1` option and
software Mesa rendering are used for a headless experiment. Startup verifies
the actual Wayland socket and instance signature, checks for `HEADLESS-0`, and
starts WayVNC on `127.0.0.1:5900`. Every wait is bounded. Native Docker runtime,
input, screenshots, portals, audio and resource qualification are still
required before treating the desktop as supported.

The package-only candidate requires the stable Omarchy 4.0.4 `omarchy-settings` package
(including its packaging release) and derives `OMARCHY_PATH` from that
package's installed file list. It fails if the package version differs from
the 4.0.4 release or it does not ship `default/hypr/bootstrap.lua`. The package profile also
includes Hyprland, Quickshell, UWSM, portal/audio dependencies, WayVNC and
Mesa. Stable recipe source `omacom/omarchy` commit
`c668141e9c42b13c80c9ca4ea108e11708c5e8a5` is distinct from the `quattro`
manual/reference checkout; the two must not be mixed.

The official [Try Omarchy for Windows guest builder](https://github.com/omacom/try-omarchy-windows)
at commit `3b497519f5f4b320b33aa7bfaf8e3ec12ecb2b64` is a separate Omarchy
4.0.4 guest-build reference. Its `guest-build/source.lock.json` pins
`jorge-huxley/try-omarchy-win` commit
`aa009bd828037727de212c1412ccbe6ed7c95c7b` and applies a reviewed patch stack
with a package lock, headless session canary, and software-graphics fallback.
Use it as source and qualification evidence when completing the root candidate
closure. This image does not import the Windows launcher, QEMU guest
integration patches, user data, or its disk installer.

The prior root factory candidate hook calls
`planOmarchyCandidate(profile, usrManifest, integration)` from [stage.ts](stage.ts)
before its full `/usr` lock gate. It stages `pacman.conf`, the selected package
list, pinned bootstrap image and the repository signing keys from existing
manifests. Candidate resolution remains unqualified until the exact package
closure and runtime qualification are recorded.

The following commands describe only that package-resolved candidate path;
the official rootfs import requires the new import hook and manifest target
to be integrated by the root factory owner.

## Container targets

Use `bun factory image build bunos-omarchy --target source-candidate` to build
the package-only candidate, then `--target desktop` for the headless session.
The root owner must add the image manifest registration and the narrow staging
hook first. Run builds and qualification only on the configured Linux VPS
factory lane; no Windows/WSL build is supported.

The image binds WayVNC to loopback by default. If mapping it from Docker, bind
the host port to loopback and terminate authenticated TLS in a trusted host
proxy. Do not publish raw VNC. The health probe limits Hyprland IPC and port
checks to three seconds.

## Browser terminal conversion

`c2w-terminal` is a separate shell-only image target. Convert it with the
qualified Linux VPS container2wasm v0.8.4 binary and `--to-js`. The v0.8.4
embedded Dockerfile defaults VM memory to 128 MiB, too small for this image;
the reviewed conversion must set `VM_MEMORY_SIZE_MB=2048` and
`VM_CORE_NUMS=2`, and replace every `make -j$(nproc)` with `make -j4` in a
hash-recorded Dockerfile copy before conversion. These are converter build
inputs, not an assertion that the browser can allocate that full guest memory.
This target is shell-only. Current c2w upstream evidence says GUI display is
not supported; the separate headless desktop-to-c2w experiment must still be
attempted and recorded as experimental, then qualified independently. See
[NOTICES.md](NOTICES.md) for converter pins and third-party notices.
