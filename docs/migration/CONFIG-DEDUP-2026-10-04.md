# Config file dedup, phase 1 (2026-10-04)

Tracked config files per repo (git ls-files; categories overlap). Counted with a path-regex sweep: systemd = unit/timer/drop-in files, github = `.github`/CODEOWNERS/dependabot, gitmeta = `.gitignore`/`.gitattributes`/`.editorconfig`/hooks, lint/ts = oxlint/oxfmt/tsconfig/rustfmt/clippy/deny/bunfig.

| Repo | systemd | nginx | github | gitmeta | lint/ts | config/*.json |
| --- | --- | --- | --- | --- | --- | --- |
| aphrody before -> after | 57 -> 51 | 29 -> 29 | 13 -> 13 | 30 -> 30 | 548 -> 544 | 66 -> 61 |
| yolo before -> after | 0 | 0 | 6 | 49 -> 29 | 166 -> 147 | 0 |
| iecode before -> after | 15 | 27 | 19 -> 12 | 21 | 45 | 6 |
| aphrody-py | 0 | 0 | 5 | 4 | 1 | 1 |

Removed:

- aphrody: six retired `systemd/*.service.example` templates (units retired 2026-09-25 in `config/service-catalog.json`) and their verifier `scripts/check-aphrody-stack-units.sh`; `config/shenron` mirror configs (oxlint, oxfmt, tsconfig, turbo, knip, bunfig) that duplicated the root bases.
- yolo: 19 per-crate `rustfmt.toml` byte-identical to the root; 20 per-plugin Tauri `android/ios/.gitignore` merged into the root `.gitignore`.
- iecode: 7 inactive upstream CI recipes under `.github/upstream` (gecko, lua-src).

Remaining candidates (phase 2, need a generator): systemd service/timer pairs from one catalog, RG/NIE nginx confs from `config/rg/host/nginx-routes.json`, a shared `.github` for issue/PR templates, per-crate rustfmt variants in yolo (59 + 32 files), per-package tsconfig/oxlint pairs (UI packages are owned by another agent and untouched).

## Phase 2 (2026-10-04)

Before -> after, tracked files per repo.

| Item | Before -> after | Mechanism |
| --- | --- | --- |
| aphrody `config/systemd/user` units | 28 files (27 user units + drop-in) -> 0 | one catalog, `yolo/packages/core/src/units/catalog.json` (430 lines incl. drop-in), rendered on demand |
| yolo unit catalog | 0 -> 3 source files (catalog, renderer, CLI) + test | 5 timer units derived from their service entry, `Type=`/`[Install]` implied |
| iecode RG/NIE nginx | 24 -> 5 tracked nginx-named files (`rg-production.conf` 235 lines -> `scripts/rg/nginx-gen.ts`; 2,949 lines removed net of generator) | `rg.conf` rendered from `config/rg/host/nginx-routes.json`, byte-identical to the previous file |
| aphrody shared `.github` forms | 6 hand-written yolo/aphrody-py templates -> 1 source (`config/github/templates.json`) + renderer, output byte-identical | `scripts/tools/infra/github-templates.ts [--check]` |
| yolo rustfmt.toml | 96 -> 93 | 3 files differing from the root only by an `edition` key cargo overrides |
| yolo Bun FFI | none -> `@aphrody/runtime-sdk/ffi` (`nativeLibrary`, owned-buffer readers, `toCString`) | extracted from iecode `packages/inagle/src/ffi/nie.ts` |

Consumers rewired: `aphrody-update systemd check|install` (renders from yolo, `APHRODY_YOLO_ROOT` or `~/yolo`, writes copies instead of symlinks, keeps differing files as `*.pre-update-<ts>`), `scripts/dev/ui/install-local-app.ts`, `scripts/release/install-linux-host-bridge.sh`, `config/web.json`, `yolo/config/host/toolchain.json`, `scripts/audit/web-verify.ts`; the `unit` area of `host-paths.ts` is gone with the files it classified. iecode: `scripts/rg/assemble-vps-release.sh` builds `nginx/rg.conf` with the generator.

Removed as superseded by `rg-production.conf` (per their own headers, 2026-09-26): the legacy per-host RG vhosts (`rosegriffon`, `api`, `cdn`, `achillea`, `ranked`, `azalee`), `supabase-compat.inc`, `supabase-internal.conf`, the includes only they used, `00-rg-stats.conf`, the blue/green `generated/` fragments (no producer or consumer in the tree) and two orphaned templates (`stack-ip.conf`, `staging-nds.conf`). Git history keeps them; a live host that still has them installed will show them as live-only in `scripts/rg/infra.ts`.

Not done in this phase:

- 59 turbo/next and 32 vendored Tauri `rustfmt.toml` files are real upstream style variants (4-space/import grouping, or default style); they have no shared parent directory, so one hoisted file would change the root-formatted yolo crates. They stay.
- iecode `packages/inagle/src/ffi/nie.ts` still carries its copy of the library discovery and owned-buffer helpers. Rewiring it needs a new `@aphrody/runtime-sdk` archive: yolo revision, producer pack, then the pin in aphrody `config/sibling-checkouts.json` and the iecode catalog and lockfile.
- iecode `aphrody-softraster` is byte-identical to `aphrody/crates/ui/softraster` apart from a description; `aphrody-render` has diverged. Replacing the copy needs a Cargo dependency change and a Cargo gate, which workers do not run.
- aphrody `systemd/` (system units: shenron backups, bot, site, tunnels) and `config/systemd/aphrody-privileged-kernel.service` stay hand-written system-scope units.
