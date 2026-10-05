<!-- SPDX-License-Identifier: Apache-2.0 -->
# DBFR as a secondary Rust build host — 2026-10-05

DBFR (OVH VPS-3, 6 vCPU, 11 GiB RAM, Ubuntu 26.04, glibc 2.43) joins the build chain as a **secondary,
desktop-free Rust host**. The VPS stays the primary factory host. This records what was installed, what was
deliberately not installed and how work is routed. It does not certify application readiness or database
integrity on DBFR.

## Installed (user level, no system change)

| Tool | Version | Source and check |
| --- | --- | --- |
| rustup | 1.29.1 | `rustup-init` from static.rust-lang.org, SHA-256 verified against the published `.sha256` |
| Rust toolchain | 1.98.1 (minimal profile, `rustfmt`, `clippy`) | the repository pin (`rust-toolchain.toml`), same as the VPS |
| sccache | 0.18.0 | official release tarball, SHA-256 verified; same version as the VPS |

Everything lives under `~/.cargo` and `~/.rustup`, as declared in `config/host/toolchain.json` (per-user bin
directories only). The compilers (`gcc`, `clang`, `mold`, `cmake`, `pkg-config`), `bun`, `git`, `tmux` and
`flock` were already present. The installer files were removed after the install. Nothing was installed
through APT and no service, unit, nginx or database setting was touched.

## Not installed, on purpose

The desktop development libraries are excluded from server hosts by `config/system-packages.json`
(`policy: minimum-host-surface`, `excluded.desktop`). Since decision 21 (2026-10-05) the one desktop runtime is
`tauri-runtime-cef` (CEF + `tauri-winit` + GTK 4): the GTK 3 / WebKitGTK libraries (`libgtk-3-dev`,
`libwebkit2gtk-4.1-dev`, …) left the dependency graph and the host list, and the libraries a desktop build needs are
`libgtk-4-dev` and the Chromium libraries of `workstationLinux`. DBFR keeps its minimum surface, so packages whose
dependency graph reaches `gdk4-sys` or `gtk4-sys` (`desktopSysCrates`) cannot build there; the VPS builds them with
`CEF_PATH=/srv/aphrody-build/cache/cef`.

## Routing (`scripts/build/rust/vps-cargo.ts`, `config/host/vps-cargo.json`)

`hosts.dbfr.desktopLibraries` is `false`. The requirement is computed from `cargo metadata` (Linux target, cached
by `Cargo.lock` hash): normal and build edges decide plain `check`/`build`/`clippy`, dev edges also count for
`test`, `bench`, `nextest` and `--all-targets`/`--tests`/`--examples`.

- `--host dbfr` with such a package fails before any transfer and names the packages.
- `--host auto` stays on the VPS (and waits for its lock) instead of falling back to DBFR.
- With the lock after the CEF-only migration (`cargo metadata`, Linux target, 231 members), 39 workspace members need
  the libraries for plain builds (`aphrody-app`, `aphrody-tauri`, `aphrody-tauri-runtime-cef`, the Tauri plugins,
  `aphrody-drive`, `aphrody-tauri-wrap`, …) and 14 more through dev dependencies (`aphrody`, `aphrody-command`,
  `aphrody-ffi`, `aphrody-tauri-cli`, …). Before the migration the count was 42 plus 14 (`aphrody-tao`,
  `aphrody-wry` and the wry runtime reached the GTK 3 `-sys` crates). `gtk`, `gdk`, `webkit2gtk`, `libappindicator`,
  `wry` and `tao` no longer appear in the graph.

## Measured

`vps-cargo run --host dbfr -- check -p aphrody-boq -p aphrody-gateway -p yolo-core` (3 jobs, nice 10 under the
factory guard, cold sccache): 43.2 s; DBFR load average peaked at 0.63; memory in use unchanged at about
4.5 GiB of 11 GiB. PostgreSQL and Redis stayed active. Limits: one run, no concurrent production traffic
measurement, caches are cold (`SCCACHE_CACHE_SIZE` 8G).

## State observed the same day

- nginx was inactive and privoxy masked before this work (not changed here); Postgres and Redis active.
- `/srv/shenron`, the contents of `/home/ubuntu` and `/srv/aphrody-infra` had been removed on DBFR by an
  operation that was not part of this batch; the VPS copy of `/srv/shenron/shared` (32 GB) is the only one.
  Back it up before any operation that could touch it.
