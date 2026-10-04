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
