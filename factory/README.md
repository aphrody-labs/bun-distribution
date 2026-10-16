# Bun OS factory

The root CLI owns Arch/pacman source resolution, offline rootfs construction
and image assembly. The native Windows workstation plans and prepares source;
Linux commands run on an explicitly selected native, SSH or Docker host.

```sh
bun src/cli.ts factory --action plan --composition server --snapshot YYYY-MM-DD
bun src/cli.ts graph --composition server
bun src/cli.ts factory --action resolve --root /ABSOLUTE/FACTORY --composition server --snapshot YYYY-MM-DD
bun src/cli.ts factory --action rootfs --root /ABSOLUTE/FACTORY --composition server --lock /ABSOLUTE/LOCK.json --executor docker
bun src/cli.ts rootfs-stage --out /ABSOLUTE/STAGE --receipt /ABSOLUTE/JOB/receipt.json --composition server
```

Use the actual emitted lock path. Resolution uses a fixed Arch archive date,
an empty package database and the official digest-pinned bootstrap image.
Package archives, detached signatures and exact versions form the root lock.
Rootfs construction verifies hashes and approved signing fingerprints, then
installs the full locked closure offline in an isolated root. It checks the
installed inventory and hashes the rootfs archive. Jobs and logs remain under
the explicit factory root; the existing shared heavy lock covers execution.
No packages are installed on the host. Uncertain container cleanup retains
the job claim for operator recovery rather than stealing an active build slot.

`server` is headless, `desktop` selects COSMIC and `gaming` selects an optional
Gamescope session. Runtime/rendering profiles `full` and `perf` remain separate
from system composition. Complete upstream recipe catalogs are selectable
inputs, not one conflicting all-packages transaction. CPU tuning, alternate
kernels, Hyprland and imported services need explicit selection and gates.

`arch/sources.json` records fork readbacks and pinned source references;
`.gitmodules` owns their independent histories. The catalogs preserve upstream
recipes, Rust manifest/lock references, build tools, SDK/library declarations
and license notices. Source export of these new owners still requires their
nested gitlink/LFS closure and size inventory; a fork is not a built package.

The final image requires an independently qualified Bun runtime/source stage
plus `arch/rootfs.tar` and its matching receipt. Rootfs success is not kernel,
boot, desktop, hardware, update or release qualification.

See [the architecture decisions](../docs/architecture/arch-distribution.md).
The [Ubuntu compatibility factory](UBUNTU.md) uses `ubuntu.ts` and
`ubuntu-profile.json`; it is not the primary Bun OS factory.

Native Windows source/tool inspection reuses the installed MSYS2 owner:

```sh
bun src/cli.ts factory --action host --msys-source-root SOURCE_DIRECTORY --msys-home USER_HOME
```

The options also accept `APHRODY_MSYS2_SOURCE_ROOT` and `APHRODY_MSYS2_HOME`.
Without an explicit source root, the inspector derives it from native pacman
on PATH. It reads source identities, junction state, guidance metadata and
`pacman -V/-Q`; it does not install packages, import Home contents or execute
the existing `cym` pipeline. Different checkout revisions remain visible.

The [server qualification](arch/qualification/server-linux-x64.json) records
the executed 137-package, signature-verified, offline rootfs assembly.
