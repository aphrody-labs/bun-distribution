# System utilities inventory (coreutils, util-linux, binutils, ...)

Status: 2026-10-16. Scope: `crates`, `packages`, `apps`, `vendor`, `toolchains` of this
checkout, sibling repositories in `C:\src\*` (`android`, `blender`, `iecode`, `rea`,
`bun-engine`, `shenron`, `aphrody`, `bun`) and `~/.cargo/registry`.

## Implementations found

| Implementation | Path | Language | License | Consumers | Notes |
|---|---|---|---|---|---|
| `bun_coreutils` (uutils multicall, 79 `uu_*` applets) | `toolchains/bun/src/coreutils` | Rust | MIT (uutils) | `bun` runtime (`src/runtime/cli/mod.rs` argv0 dispatch, `src/runtime/shell/states/Cmd.rs` Bun Shell fallback), cargo feature `coreutils` (off by default) | Sources fetched from `aphrody-labs/uutils-coreutils` by `scripts/build/deps/uutils.ts`; not checked out (`vendor/uutils` absent). Excludes Bun Shell builtins by design. |
| Same `bun_coreutils` | `C:\src\bun\src\coreutils` | Rust | MIT | standalone `aphrody-labs/bun` clone | Same repository as `toolchains/bun` (another checkout, not a source duplicate). |
| Bun Shell builtins (20) | `toolchains/bun/src/runtime/shell/builtin/*.rs` | Rust | MIT (Bun) | Bun Shell `$\`...\`` | `basename cat cd cp dirname echo exit export false ls mkdir mv pwd rm seq test touch true which yes`; async, in-process, cross-platform. |
| `aphrody-nu` | `crates/aphrody-nu` | Rust | Apache-2.0 | Aphrody kernel shell subsystem | Spawns an external `nu`; embeds no Nushell command crates. |
| `aphrody-proc` | `crates/aphrody-proc` | Rust | Apache-2.0 | llama supervisor, sandbox, training runner | Process groups, kill, liveness; not a `ps`/`kill` CLI. |
| `aphrody-fsindex` | `crates/aphrody-fsindex` | Rust | Apache-2.0 | Aphrody search | FTS5 index; not a `find`/`locate` CLI. |
| PE/ELF inspection (`goblin`, `object`) | `crates/aphrody-nie-pe-inspect`, `aphrody-nie-re`, `aphrody-nie-cli`, `crates/re`, `crates/ghidra-decompiler`, `C:\src\iecode\crates\nie\*` | Rust | per crate | RE tooling | Domain RE analysis (PE recovery), not `nm`/`readelf` CLIs. |
| `vendor/cachyos-*`, `vendor/cachyos-linux` | `vendor/` | mixed | upstream | `/usr` factory | Packaging/kernel sources; no utilities. Previous `vendor/llvm`, `vendor/make`, `vendor/cmake` entries are deleted in the working tree by a concurrent agent. |
| GNU coreutils, util-linux, binutils, procps-ng, findutils, diffutils | Arch `core` packages | C | GPL | `/usr` factory (`base`, `base-devel`) | Pulled by pacman, not vendored. |

Siblings `android`, `blender`, `rea`, `bun-engine`, `shenron`, `aphrody`: no coreutils,
util-linux, binutils or Nushell implementation. `~/.cargo/registry`: `object` 0.36/0.37/0.39,
`gimli`, `addr2line`, `goblin`, `sysinfo`, `similar`, `rustc-demangle`; no `uu_*` crate was
cached before `bunos-utils`.

## Canonical owners

| Suite | Canonical owner | Applets |
|---|---|---|
| In-process `bun` multicall and Bun Shell fallback | `toolchains/bun/src/coreutils` (`bun_coreutils`) | unchanged |
| Bun Shell builtins | `toolchains/bun/src/runtime/shell/builtin` | unchanged; the builtin set stays in Bun Shell, every other command falls back to `bun_coreutils` |
| System `/usr` multicall | `crates/bunos-utils` | see `bunos-utils --list` |
| coreutils | uutils `uu_*` 0.12 (MIT), feature `coreutils` | 66 portable + 13 unix applets |
| findutils | uutils `findutils` 0.10 (MIT), feature `findutils` | `find`, `xargs` |
| diffutils | `bunos-utils::diffutils` on `similar` | `diff` (unified, `-q`), `cmp` |
| procps | `bunos-utils::procps` on `sysinfo` | `ps`, `free`, `pidof`, `pgrep`, `pkill` (`kill`, `uptime` come from coreutils) |
| binutils (read-only) | `bunos-utils::binutils` on `object` + `addr2line`/`gimli` | `nm`, `size`, `readelf`, `objdump`, `strings`, `addr2line`, `ar t|p` |
| util-linux | Arch `util-linux` package | no Rust owner yet |

Both multicalls share the uutils upstream; `bunos-utils` uses crates.io releases because the
fork checkout of `toolchains/bun` is fetched at build time and `toolchains/bun` is excluded
from the root Cargo workspace. When `vendor/uutils` becomes a flat submodule, both switch to
path dependencies on it.

## Duplicates

No source duplicate was retired: the Bun Shell builtins and `bun_coreutils` already split
command names (one implementation per name inside `bun`), and no `aphrody-*` crate
reimplements a utility CLI. `aphrody-nu` keeps delegating to `nu`; Nushell's own commands
are not vendored.

## `/usr` integration

`factory/usr/manifest.json` key `multicall` declares the crate, target, features and link
directory. The overlay ships `usr/share/bun-os/bunos-utils.applets` and
`usr/lib/bun-os/install-bunos-utils <root>`, which links every applet to
`/usr/bin/bunos-utils` under `/usr/lib/bunos-utils/bin`. Pacman keeps owning the GNU names in
`/usr/bin`; prepend the link directory to `PATH` to prefer the Rust applets.

## Remaining

- Build the Linux `bunos-utils` binary in the factory and call `install-bunos-utils` from
  `factory/usr/builder.sh` (owned by the `/usr` agent).
- util-linux (`lsblk`, `mount`, `dmesg`, ...): uutils `util-linux` is not published; fork into
  `aphrody-labs` and add as a flat submodule.
- binutils write operations (`strip`, `objcopy`, `ar r`) on `object::write`.
- uutils procps (`uu_ps`, `uu_top`) once published, replacing the `sysinfo` applets.
