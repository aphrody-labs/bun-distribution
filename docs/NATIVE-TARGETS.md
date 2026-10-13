# Native source targets

`factory/native-targets.ts` builds the source owners pinned by `sources.lock.json`.
Its catalog separates executable build steps, host prerequisites and runtime
qualification. Source checkouts must match the exact pin and contain no concurrent
changes. Output directories are new, outside the sources, and inside the selected
factory. Jobs take the factory's exclusive lock and require 50 GiB free. Linux
builds also hold the existing shared heavy-job lock from `factory/profile.json`;
its parent directory must be provisioned by the factory owner.

```sh
bun factory/native-targets.ts plan apt-gnu
bun factory/native-targets.ts status apt-gnu --source ../apt --out /home/build/apt-job
bun factory/native-targets.ts build apt-gnu --source ../apt --out /home/build/apt-job
```

| Target            | Build host                            | Owner artifact                                             |
| ----------------- | ------------------------------------- | ---------------------------------------------------------- |
| linux-aphrody-bun | Native Linux x64                      | Kernel, modules and headers from the aphrody-bun branch    |
| wsl-windows       | Native Windows x64, VS2022/UCRT       | WSL PE executables, using native Clang for guest helpers   |
| wslg-system       | Linux x64 Docker factory              | WSLg system tar and VHD from its Azure Linux Dockerfile    |
| wsl-kernel        | Native Linux x64                      | Aphrody WSL defconfig kernel and modules/headers/perf VHDX |
| apt-gnu           | Native Linux x64/glibc                | Official APT libraries, tools and methods                  |
| apt-windows-msvc  | Proposed native Windows x64/UCRT port | libapt-pkg and apt.exe after the APT source port           |

For `linux-aphrody-bun`, pass an explicit `--kernel-config` selecting x86_64 and
`CONFIG_BUN_ACCEL` and `CONFIG_RUST`. The WSL kernel uses its branch's
`arch/x86/configs/aphrody_wsl_defconfig`, which selects built-in Bun acceleration.
Both kernel targets use `LLVM=1`, Rust, matching `rust-src`, libclang and bindgen;
the owner's `rustavailable` target validates compiler compatibility before the
kernel build. Builds recheck those selections after `olddefconfig` and use
an output `.config`; the input configuration is not overwritten. WSL native builds select Visual Studio 2022 and SDK
10.0.26100.0, and reject `UserConfig.cmake` to avoid automatic deployment.
These recipes never register distributions, edit `.wslconfig`, or start WSL.

WSLg requires `--config` with an explicit version, immutable `baseImage` digest,
and `externalPins` mapping each vendor path in the catalog to its exact Git SHA.
FreeRDP, Weston, PulseAudio, Mesa and DirectX-Headers are external sources rather
than gitlinks. Their checkouts must already exist at the required `vendor/` paths.
The Dockerfile's component licenses remain with the artifacts. The Windows RDP
plugin has a separate native Visual Studio build owner.

The official APT pin requires C++23, GNU/POSIX file/process/signal interfaces,
Unix generators and libraries. Its native Windows recipe fails before a build
until those source owners are ported. The practical port boundary includes
MSVC DLL exports and generators, UCRT 64-bit file offsets, Win32 mapping/locking,
Unicode paths, process/pipes, dependencies built for the same runtime, signature
verification, and an explicit package transaction backend. The Bun package
conversion frontend named `apt.exe` is a distinct artifact.
GNU APT installation uses a job-local `DESTDIR`, preserving `/usr` runtime paths
without installing files into the factory host's package directories.

Build receipts contain artifact hashes and ABI evidence. Boot, deployment,
signature trust, package transactions and desktop/GPU behavior remain separate
qualification steps.

Pinned source references:

- [Linux fork](https://github.com/aphrody-labs/linux/tree/47f637c546bf4bb274c7149815ed66d748e4f325).
- [WSL native build](https://github.com/aphrody-labs/WSL/blob/341f1ddf76f089ff6351590b03f92bad30041725/doc/docs/dev-loop.md).
- [WSLg build sources](https://github.com/aphrody-labs/wslg/blob/6942bb534b537302a7a22617261d9274db3cfa37/CONTRIBUTING.md).
- [WSL kernel owner](https://github.com/aphrody-labs/WSL2-Linux-Kernel/blob/e5043002ed6f0b0eb17a0fb9efafa794045853ed/README.md).
- [Official APT](https://salsa.debian.org/apt-team/apt/-/tree/745fc126218c7cb3df48b22bbc7c7098fa2f7966).
