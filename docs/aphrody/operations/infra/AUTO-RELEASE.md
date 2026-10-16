<!-- SPDX-License-Identifier: Apache-2.0 -->
# Automatic release on every push to main

Owner: Infra. Chain: push on `main` -> gates -> build matrix -> immutable release on `downloads.aphrody.com`
(`latest.json` + `SHA256SUMS`) -> hosts and PCs update themselves. No new stack: GitHub Actions orchestrates, the
existing owners act ([DOWNLOADS](DOWNLOADS.md) publisher, [IMMUTABLE-RELEASES](IMMUTABLE-RELEASES.md), [UPDATE](UPDATE.md)).

| Stage | Where | Owner |
| --- | --- | --- |
| Gates | `.github/workflows/release-main.yml` job `gates` (release tests, lint, format, typecheck) | root Bun gates |
| Build matrix | jobs `build` (ubuntu-24.04, windows-2025, windows-11-arm optional) and `wasm` (wasm32-unknown-unknown) | Cargo, `--locked` |
| Publish | job `publish` streams `scripts/release/auto-release.sh` to the vps: `downloads:publish plan/build/release/verify` for the pushed SHA, under a `flock` | `scripts/release/publish-downloads.ts` |
| Hosts | job `deploy`: `aphrody self update` on vps and dbfr | `aphrody self update` |
| Continuous | `aphrody-self-update[-dbfr].timer` (15 min), Windows task `Aphrody self update` (30 min + logon) | catalog `tools/config/host/catalog.json` |

The CI matrix is the gate (the revision must build and start on each OS); the published artifacts stay the ones of the
factory publisher (glibc gate, `xwin` Windows build, secret scan, checksum verification), so there is one source of
release truth. Bun is not rebuilt: the fork's own release and `aphrody.com/bun/setup.*` are consumed as they are, and
the site publication timer of the Bun fork is not duplicated.

## Concurrency and safety

- `concurrency: release-main`, `cancel-in-progress: false`: a running release is never interrupted; a push during a
  run queues one newer run. `auto-release.sh` also holds `~/.aphrody/deploy/auto-release.lock`, so it waits for a manual
  tmux release instead of overlapping it. It builds in the single checkout `~/src/aphrody` (fast-forward only; a
  newer `main` is published instead of an older revision).
- Releases are immutable (`releases/<UTC>-<commit12>`, `current` flipped atomically, five kept). Docs-only pushes
  (`docs/**`, `*.md`, `.coord/**`) do not release.
- Secrets: repository `release` environment, never in the workflow text. `RELEASE_SSH_KEY` (private key of a
  dedicated deploy user), `RELEASE_KNOWN_HOSTS` (pinned host keys), variable `RELEASE_VPS` (`user@host`). Strict host
  key checking, key only in the runner's `~/.ssh`. No secret reaches `downloads.json` artifacts (the publisher scans).

## `aphrody self update`

```text
aphrody self update [--check] [--force] [--rollback] [--components aphrody] [--base <url>]
```

1. Reads `latest.json` once, takes `release.id` (validated), compares with `<data>/aphrody/self-update.json`.
2. Downloads `install.sh` / `install.ps1` from the same server and runs it pinned to that release
   (`APHRODY_RELEASE`): SHA-256 against the release `SHA256SUMS`, the new binary runs before activation, links
   refreshed by `self install-path`.
3. Runs the new binary again; if it does not start, relinks the previous binary and fails (rollback).
4. Records `previous_bin` / `previous_release`; `--rollback` returns to it. The three newest installed directories are
   kept, the active and previous ones never pruned.

Exit code is non-zero on any failure, so the unit shows `failed` and `aphrody-selfheal` and the workflow see it.

## Declared units (applied by the `boot` / host plan owner)

- `tools/config/host/systemd/aphrody/aphrody-self-update.{service,timer}` (vps) and `-dbfr` twins, catalog entries
  `aphrody-self-update*`. Run as `ubuntu` with `~/.local/bin/aphrody`; the condition skips hosts without the binary.
- Windows: catalog `scheduledTasks` entry `Aphrody self update` (`bootEntry`), declared in the boot catalog
  (`tools/config/service-catalog.json`) and registered by `aphrody infra boot apply --host local --entry "Aphrody self update"`
  (hidden S4U task, every 30 minutes and at logon, 15-minute limit). Removal: `schtasks /Delete /TN "Aphrody self update" /F`.

Apply: `bun packages/core/src/host/cli.ts` host plan (plan first), then `systemctl enable --now aphrody-self-update.timer`.

## First install and recovery

1. Declare the secrets above and the `release` environment (reviewers optional).
2. Host: `curl -fsSL https://downloads.aphrody.com/install.sh | sh` once, then apply the unit.
3. Failed release: the previous `current` is untouched until `release` flips it; hosts keep the installed one.
   Manual: `aphrody self update --rollback`, or `bun run downloads:publish verify`.
