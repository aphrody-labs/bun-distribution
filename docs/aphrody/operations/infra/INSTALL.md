<!-- SPDX-License-Identifier: Apache-2.0 -->
# Installation: one layout, one path (`aphrody self install`)

Single install path for Windows 11, Ubuntu and wasm. The one-line installers only download and verify; the
binary does the work. Sources: `crates/infra/aphrody-command/src/self_install.rs`, `scripts/install/install.{sh,ps1}`.

## One click

```sh
curl -fsSL https://downloads.aphrody.com/install.sh | sh                    # Linux, macOS
curl -fsSL https://downloads.aphrody.com/install.sh | sh -s -- --host vps   # remote deployment (vps, dbfr)
curl -fsSL https://downloads.aphrody.com/install.sh | sh -s -- --target wasm
```

```powershell
irm https://downloads.aphrody.com/install.ps1 | iex
& ([scriptblock]::Create((irm https://downloads.aphrody.com/install.ps1))) --host dbfr
```

Both read `latest.json`, select the immutable release once, check the archive against the `SHA256SUMS` of that
release, run the downloaded binary, then call `aphrody self install --bin <downloaded> [args]`. Environment:
`APHRODY_DOWNLOAD_URL`, `APHRODY_RELEASE`. `APHRODY_COMPONENTS` other than `aphrody` runs the layer above the
binaries, `install-full.{sh,ps1}` (Claude plugins, MCP declaration, desktop app).

The Bun fork is not rebuilt or reinstalled here: its release and setup are consumed from
`https://aphrody.com/bun/setup.{sh,ps1}` (`self install` prints the address when `bun` is missing).

## Canonical layout

| OS | Root | Links / PATH |
| --- | --- | --- |
| Windows | `%LOCALAPPDATA%\aphrody\{bin,lib,share}` | `bin` on `HKCU\Environment\Path`; former names are hard links of `aphrody.exe` |
| Linux (user) | `~/.local/share/aphrody/{bin,lib,share}` | symlinks in `~/.local/bin`; a marked block in `~/.profile` (and `.bashrc`, `.zshenv` when present) adds it to `PATH` |
| Linux (root) | `/opt/aphrody/{bin,lib,share}` | same links in `~/.local/bin` |

`share/manifest.json` is the install manifest (`schemaVersion`, `version`, `target`, `commit`, `installedAt`,
`root`, and every file of `bin/`, `lib/`, `share/wasm/` with `sha256` and `size`). It is rewritten atomically at the end.

## `aphrody self install`

`[--bin <path>] [--root <dir>] [--target native|wasm] [--host local|vps|dbfr] [--url <base>] [--no-boot]
[--keep-legacy] [--dry-run]`

1. Copies the binary and its sibling binaries (plus `lib/`, `share/`, `release.json`) of the source directory into
   `bin/`, through a temporary name; a running executable is moved aside (`.old`). The result runs `--version` first.
2. Registers `bin` on PATH and links every multi-call name (`aphrody self install-path` logic, one implementation).
3. Writes the shell profile block (POSIX).
4. Removes former installations (no legacy binary): `<root>/lib/aphrody/replaced` and the versioned script layout
   `~/.local/lib/aphrody` (skipped when the running binary lives there; `--keep-legacy` keeps them).
5. Writes the manifest.
6. Runs `aphrody infra boot apply --host local` when `aphrody infra boot` exists in this build, otherwise says so and skips.

`--host vps|dbfr` runs the one-line installer on that host through `aphrody infra ssh exec` (host catalog and
credentials stay with Infra). `--dry-run` prints the plan and changes nothing.

## wasm32

Delivered: `@aphrody/cli-wasm` (`packages/infra/cli-wasm`, built from `crates/infra/aphrody-command-wasm`: pure commands
and RAG JSON/vector operations in one module), staged by `scripts/release/stage-cli-wasm.ts` and published in the same
`latest.json` / `SHA256SUMS` as the other artifacts (`aphrody-cli-wasm-<version>-<commit9>-wasm32-unknown-unknown.tar.gz`,
kind `wasm`). `aphrody self install --target wasm` downloads it, verifies the SHA-256 and extracts it to
`<root>/share/wasm/`, recorded in the manifest. In a Bun project, depend on `@aphrody/cli-wasm` instead.
Everything that needs processes, sockets, a filesystem or tokio stays native.
