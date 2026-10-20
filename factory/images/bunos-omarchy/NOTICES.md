# Bun OS Omarchy container candidate notices

The preferred complete guest input is the official Omarchy release
`omacom/try-omarchy-windows` v0.12.0, pinned at commit
`3b497519f5f4b320b33aa7bfaf8e3ec12ecb2b64` (MIT). Its pinned guest builder
`jorge-huxley/try-omarchy-win` commit
`aa009bd828037727de212c1412ccbe6ed7c95c7b` is also MIT-licensed. The release
rootfs contains Omarchy 4.0.4 package release 10 from
`omacom/omarchy` commit `c668141e9c42b13c80c9ca4ea108e11708c5e8a5` (MIT), plus
the packages and licenses listed by its signed package lock. Preserve the
upstream notice and every installed package's notice and license files when
building or redistributing the image. Full asset identity is in
[SOURCE-PROVENANCE.md](SOURCE-PROVENANCE.md).

The local Containerfile, scripts and candidate configuration are MIT-licensed.
The image installs packages from signed pacman repositories; retain the
installed package license and notice files under `/usr/share/licenses`.
Do not add rules that exclude license files.

The earlier package-only candidate's stable Omarchy package recipes are based on `omacom/omarchy` commit
`c668141e9c42b13c80c9ca4ea108e11708c5e8a5` (4.0.4, MIT). The separate
`quattro` manual/reference checkout at
`ce39c5e9e9e4f5db7e023a07d0eeda9351ef9c80` is not a build input for this
candidate. The image records exact installed package versions with
`pacman -Q`; signed repository resolution alone does not provide an immutable
closure.

The guest builder's Windows launcher and guest-specific patch stack are not
copied wholesale into this image. Review individual patches before reuse and
retain their original notices and license terms.

## Optional c2w terminal conversion

Only the `c2w-terminal` target is documented as a browser terminal. Its
converter is container2wasm v0.8.4 tag commit
`6ed3d98882a2b22eafc1334f574c364a5b2b8c47`, Apache-2.0. The verified VPS
release asset tar SHA-256 is
`1142ab95212578c0c7f666de830de6945f2abbea1713d1e07a7cb04072e00f31`.
This binary pin is distinct from the separate c2w `main` checkout. Verify
`c2w --version` and the release asset digest on the VPS before converting.

The c2w output may include Bochs (LGPL-2.1), Linux (GPL-2.0), QEMU (GPL-2.0),
TinyEMU (MIT), GRUB (GPL-3.0), tini (MIT), runc (Apache-2.0), binfmt (MIT),
vmtouch (MIT), BusyBox (GPL-2.0), xterm-pty (MIT), browser_wasi_shim
(MIT/Apache-2.0), and gvisor-tap-vsock (Apache-2.0). Preserve notices shipped
by the exact converter output and make corresponding source obligations
available before redistribution. Inspect the v0.8.4 output inventory before
publishing a converted image.
