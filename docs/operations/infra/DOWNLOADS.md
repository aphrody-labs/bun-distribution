<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody downloads: site, publisher and GitHub releases

Owner order of 2026-10-06 (explicit publication authority for exactly this scope): the single `aphrody`
multi-call binary (it carries the MCP server, `aphrody-mcp`), the Bun CLI `yolo` with its runtime artifact, SDK and
templates, and the Aphrody, yolo and Shenron plugins are downloadable from our site and from GitHub releases of
existing repositories.

## Public path and its limits

| Path | Content | Auth |
| --- | --- | --- |
| `https://downloads.aphrody.com/` (also `https://aphrody.com/`, `https://www.aphrody.com/`) | index page | none, by design |
| `/latest.json` | manifest: `name`, `version`, `platform`, `target`, `url`, `sha256`, `size` per artifact | none, by design |
| `/SHA256SUMS`, `/files/<file>.sha256` | checksums of the current release | none, by design |
| `/install.sh`, `/install.ps1`, `/install-yolo.sh` | one-line installers | none, by design |
| `/files/<file>` | archives, immutable file names `<component>-<version>-<commit9>-<target>.<ext>` | none, by design |
| `/health` | liveness of the origin (503 until a release is published) | none, loopback and through nginx |

The site is read-only (GET and HEAD only), serves nothing but published, checksummed release files and exposes no
write endpoint, so it stays public and unauthenticated like `cdn.aphrody.com`. GitHub release assets of private
repositories need an authenticated token: the download server is the public path.

One line installs:

```sh
curl -fsSL https://downloads.aphrody.com/install.sh | sh
curl -fsSL https://downloads.aphrody.com/install.sh | APHRODY_COMPONENTS="aphrody yolo plugin-aphrody plugin-yolo plugin-shenron" sh
```

```powershell
irm https://downloads.aphrody.com/install.ps1 | iex
```

Each installer checks every download against the release `SHA256SUMS`, runs the new binary before linking it, and
calls `aphrody self install-path` so the former standalone names (`aphrody-mcp`, `aphrody-infra`, `aphrody-kernel`,
...) are links to the single binary. `yolo` goes through `apps/yolo/install.sh` (published as `install-yolo.sh`),
whose layout is `bin/`, `artifact/` (verified runtime), `packages/engine/runtime`, `m3/templates`.

## Components

Declared in `config/downloads.json`.

| Component | Source | Platforms |
| --- | --- | --- |
| `aphrody` | factory build of a pushed revision: `scripts/build/rust/cargo-serial.sh build --release --locked -p aphrody --bin aphrody` | linux x86_64 (glibc 2.39 gate through `scripts/audit/elf-glibc-imports.ts --max 2.39`), windows x86_64 when the factory has an `xwin` build |
| `yolo` | `bun build --compile` of `apps/yolo/cli/src/index.ts`, verified runtime artifact `~/.yolo/runtime/<target>/current`, `packages/engine/runtime`, `m3/templates` | linux x86_64 |
| `plugin-aphrody`, `plugin-yolo`, `plugin-shenron` | `git archive` of the pushed HEAD of `plugins/aphrody`, `plugins/yolo` and `plugin/` of `aphrody-labs/shenron` (tracked files only) | any (tar.gz and zip) |

Not published, and why (also written in `latest.json` `notes`): macOS (no target declared by the factory or the
toolchain catalog), Windows `yolo` (no packaged `yolo-runtime` artifact for Windows).

No signature: the repository defines no signing key for CLI artifacts (only the unset `APHRODY_UPDATER_PUBKEY` and
`TAURI_SIGNING_PRIVATE_KEY` names of the desktop updater). Integrity is SHA-256, checked by the host after every
upload and by the installers.

## One-command republish

```sh
bun run downloads:publish plan
bun run downloads:publish build   --revision <full-sha>     # factory prepare + build, waits for the jobs
bun run downloads:publish release --revision <full-sha>     # stage, secret scan, upload, flip `current`
bun run downloads:publish github                            # releases on the configured existing repositories
bun run downloads:publish verify                            # public download, SHA-256, `--version`
bun run downloads:publish host-plan | host-apply --apply   # unit, vhost, certificate (first install or repair)
```

`release` refuses to publish when a staged archive or the factory binary contains a denied file name (`.env`, keys,
databases, model weights, cookies) or a token-shaped string (patterns in `config/downloads.json`). The release tree
is `/srv/aphrody-downloads/releases/<UTC>-<commit12>` on the vps; `current` is flipped atomically and the last five
releases are kept. Run it from a pushed, building revision; never Cargo in WSL.

## Host (vps, through `aphrody infra ssh`)

- `aphrody-downloads.service` (`config/host/systemd/aphrody/aphrody-downloads.service`), Bun on `127.0.0.1:8797`,
  enabled; catalog entry `aphrody-downloads` in `config/service-catalog.json`, route in
  `config/host/nginx/routes.json`, port in `config/production-topology.json`.
- nginx vhost `config/host/nginx/aphrody/downloads.aphrody.com.conf`: nginx sends `/files/` itself (sendfile, ranges),
  proxies the rest. Certificate `downloads.aphrody.com` (HTTP-01, names `downloads.aphrody.com`, `aphrody.com`,
  `www.aphrody.com`) issued by `scripts/tools/infra/issue-downloads-certificate.sh`; renewal uses the existing
  certbot timer and the shared challenge webroot. The leftover `aphrody-acme-temp.conf` (404 on the apex) was retired
  to `/etc/nginx/retired/`.
- Rollback: remove the vhost and `nginx -t`/reload, `systemctl disable --now aphrody-downloads`; releases stay on disk.

## Windows cross-build

The factory host has `clang-cl`, `lld` and the `x86_64-pc-windows-msvc` Rust target. 2026-10-06: `cargo-xwin` 0.23.1 was
installed there with `cargo binstall` (declared `windowsBuild` method of `config/host/toolchain.json`); the Windows
SDK/CRT splat is downloaded by `cargo xwin` on first use into `~/.cache/cargo-xwin` (copying the 1.1 GiB local splat
over the current uplink was not practical).

## API convergence (vps, 2026-10-06)

Observed with `aphrody infra service status` and `systemctl`: `aphrody-downloads` (new), `aphrody-fonts-proxy` (declared
active but never installed: unit, app tree `/srv/aphrody-cdn/{app,src}` from the yolo release, certificate and vhost
`cdn.aphrody.com` now installed; the vhost challenge webroot was aligned on `/var/www/letsencrypt`),
`aphrody-discord-dev`, `shenron-site`, `shenron-bot`, `shenron-mcp-http`, `shenron-pg-tunnel`, `redis-server`: enabled and active.
Shenron units were not touched. Declared `retired` services (`aphrody-site`, `aphrody-web-api`, `aphrody-ai-http`,
`aphrody-shenron-embed`, `aphrody-a2a`, `shenron-mcp`) stay retired: reviving them is a catalog decision (convergence plan).
Gap left: `shenron-backup.timer` is declared active but not installed on the vps (Shenron owner decision).

Public without authentication, by catalog design: `downloads.aphrody.com`/`aphrody.com`, `cdn.aphrody.com` (font proxy,
GET/HEAD only), `dragonballfr.com`, `cdn.dragonballfr.com`, `bot.dragonballfr.com` and `bot.aphrody.com` (Discord endpoints,
signature-checked by the bot). Observed, not changed: Postgres listens on 0.0.0.0:5432 behind the INPUT DROP firewall, and
ufw allows 3080/tcp with no listener.
