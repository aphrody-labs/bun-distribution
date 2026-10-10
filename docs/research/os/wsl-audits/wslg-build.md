# WSLg source build audit — 2026-10-01

Source: `.cache/upstream/wslg` (not in repo) (generated or machine-local artifact; presence depends on the build host), commit `6942bb534b537302a7a22617261d9274db3cfa37`. The tracked upstream files remain unmodified. Recipe read directly from `CONTRIBUTING.md`, `Dockerfile`, `build-and-export.sh`.

The complete system-distro recipe builds DirectX-Headers, Mesa (swrast and d3d12), PulseAudio, FreeRDP, rdpapplist, Weston RDP/RAIL shell and WSLGd. It installs those artifacts into an Azure Linux 3.0 runtime container, exports the filesystem tar and converts it with hcsshim `tar2ext4` v0.13.0 into an ext4-backed VHD. XWayland is a distro RPM in this recipe; its source is not compiled by the WSLg Dockerfile. Windows integration DLL WSLDVCPlugin is a separate Visual Studio v143 project, not a Linux container target.

## Source and dependency provenance

Five vendor clones use the official contributing recipe. Exact URLs/commits are recorded in `.cache/upstream/build/aphrody/wslg/sources.json` (not in repo) (generated or machine-local artifact; presence depends on the build host); there are no local patches. Azure Linux image `mcr.microsoft.com/azurelinux/base/core:3.0` pulled successfully, manifest digest `sha256:1324a2cf7ed34e5f48a1022816b205782b86c7305651658e611dcd3d30756751`.

Existing Podman 4.9.3/Buildah 1.33.7 uses rootless overlay storage. The Dockerfile runs with `podman build --format docker --network host`, keeping its compiler/dependency installation isolated in the build container. Native Debian/Ubuntu packages `golang-go` and `debootstrap` installed successfully; (removed) records the transaction. hcsshim v0.13.0 requires Go >= 1.23, so the system Go 1.22 installer automatically downloads the official Go 1.26.8 toolchain, recorded in `tar2ext4-build.log`.

## Actual build

Build started, exact argv: `.cache/upstream/build/aphrody/wslg/build-command.json` (not in repo) (generated or machine-local artifact; presence depends on the build host); complete persistent log: (removed). Seven version/vendor arguments are explicit, avoiding the Dockerfile placeholder gate. Version is `dev`, architecture `x86_64`.

Output image tag: `localhost/aphrody-wslg:x64`. Intended exports: `system_x64.tar`, `system_x64.vhd` in `.cache/upstream/build/aphrody/wslg` (not in repo) (generated or machine-local artifact; presence depends on the build host).

No active WSL system distro has been replaced or restarted. A built VHD and a successful boot/GUI integration check are separate gates. Selecting the private image is done through `systemDistro=...` in Windows `.wslconfig` and takes effect only after a separately scheduled WSL restart.

## Recipe correction from the actual build

DirectX-Headers and all 1055 Mesa targets compiled and installed successfully. PulseAudio then failed because `.dockerignore` excludes `.git`, making its `git-version-gen` return an empty version. Its `meson.build:17` indexes the numeric minor version and rejects the empty string. The tracked vendor source is unchanged. The recipe now fetches tags/history while preserving the pinned HEAD and writes its official ignored tarball-version input: `17.0-25-gc3305`, derived from git describe returning `v17.0-25-gc3305`. Invoking the source git-version-gen confirms an exact match. This metadata is recorded in `sources.json`. Failed iteration log retained in `build-pulseaudio-version-failure.log`; relaunch reuses all preceding image-layer cache.

## Component compilation and Windows plugin

All seven Linux source components have now compiled and installed successfully into the official builder: DirectX-Headers, Mesa, PulseAudio, FreeRDP, rdpapplist, Weston and WSLGd. The runtime container dependency installation remains active before the final filesystem export.

Windows WSLDVCPlugin Release x64 also built successfully, with zero errors and zero warnings. DLL and PDB, build log and SHA256SUMS are in `.cache/upstream/build/aphrody/wslg/plugin` (not in repo) (generated or machine-local artifact; presence depends on the build host). DLL SHA256: `f68452311343c0615ddbce1a5c4aed954f286994f16f236b2c75b3a81a837d25`. RC generation uses upstream UpdateRCVersion.ps1 in a staging copy, with its unsupported Windows PowerShell 5 encoding label replaced by equivalent .NET code page 1252; the canonical upstream source remains unchanged.

## Final artifacts and validation

Complete official Dockerfile build and filesystem/VHD export succeeded (exit 0). Image ID `2923ce7c3f11fb73b89d28625464ad2e6ab505d63e4995bb04dcd667b6942df7`. Artifact directory `.cache/upstream/build/aphrody/wslg` (not in repo) (generated or machine-local artifact; presence depends on the build host) contains:

- `system_x64.tar`, 748511744 bytes, SHA256 `776058d8d9788bcf43caf2606a8e7da88a43a908b382c61b4bd3476ed14d4c8d`.
- `system_x64.vhd`, 772051456 bytes, SHA256 `86db6d99e80ed1137668c58dee9d0d877c3699ed96d1fa2b0ead9a1648722f8c`.
- `system-debuginfo.tar.gz`, official split-symbols archive exported from dev-stage image `174dc079d15e`. Exact sizes/hash in `artifacts.json`.
- Windows plugin DLL/PDB under `plugin/`.

Validated ext4 superblock magic and fixed VHD footer cookie/checksum; tar includes WSLGd, Weston, PulseAudio, XWayland, wsl.conf and exact versions manifest. Network-isolated runtime container executes `weston --version` (9.0.0), `pulseaudio --version` (17.0-25-gc3305), and `Xwayland -version` (24.1.13). Dynamic dependencies resolve for WSLGd and the five critical RDP/audio/GPU modules: rdp-backend, rdprail-shell, module-rdp-sink/source and d3d12_dri; no missing libraries. Logs: `runtime-validation.log` and `module-validation.log`, including complete runtime RPM inventory.

Actual boot of this private system distro, GUI/audio/input integration and graphics performance under WSL remain untested. Existing running WSLg was preserved. Azure Linux/XWayland runtime RPMs are consumed from upstream binary repositories, not rebuilt from their source in this WSLg recipe.

## Scoped cleanup after successful export

The interrupted first build left two non-mounted Buildah working containers (`22f99983b11d88d090ba4bc1a32911a20dab7d0ad4d489243fc063b00870e9bb`, `7fbc3949142a8d72d60ec362e36139c3cc509bc162e2f64892e03e9837041f33`) plus `/var/tmp/buildah3457799225` and `/var/tmp/container_images_storage881545024`. Their source-image/container metadata and timestamps match the initial WSLg iteration. No build process remained. Those two containers were removed by exact ID, and only the two identified temporary directories were deleted. Allocated storage recovered: 5,235,585,024 bytes (4.88 GiB), including 2,985,451,520 bytes in temporary files and 2,250,133,504 bytes in writable layers. Images were compared before/after and remained identical; final WSLg image, dev images, Azure Linux base and shared devkit image remain. Standalone tar/VHD sizes reconfirmed. Evidence: `cleanup.json`.
