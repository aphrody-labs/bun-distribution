<!-- SPDX-License-Identifier: Apache-2.0 -->
# Dependency pipeline (`deps-sync`)

Owner: Infra workspace (`packages/infra/workspace/src/deps-sync.ts`, op `deps-sync`).

| Command | What it does |
| --- | --- |
| `bun run deps:sync` | Plan, report only: bun/uv (GitHub, PyPI), Tauri family (crates.io), Bun workspace (`bun outdated -r`) |
| `bun run deps:bump` | Apply: rewrite pins, `uv self update`, `bun upgrade`, `bun update -r`, record `config/deps/journal.json` |
| `deps-sync facts [--all]` | Fact-check libraries from `config/deps/watch.json` that changed: GitHub release notes + Context7 docs -> `docs/research/workspace/deps/<date>.md` |
| `deps-sync fix [--apply-fixes]` | Pre-fix: run consumer gates (tsc, cargo check), subtract `config/deps/baseline.json`, match `config/deps/fix-rules.json`, write `.coord/shared/deps-fix-<date>.md` |
| `deps-sync baseline` | Record current consumer failures so `fix` reports regressions only |
| `bun run changelog` | Regenerate `CHANGELOG.md` (config: `config/changelog.json`) from conventional commits and the journal |
| `deps-sync memory` | Write the managed block into every `~/.aphrody/workspaces/*/BOOT.md` and `memory/deps-state.md` |
| `bun run deps:run` | plan, apply, facts, fix, changelog, memory in one pass |

Registries: crates.io, npm, GitHub API (token from `GITHUB_TOKEN`, `GH_TOKEN` or `gh auth token`), PyPI, Context7
(`https://context7.com/api/v1`, optional `CONTEXT7_API_KEY`, `CONTEXT7_API_BASE`).

Rules kept: Cargo is never bulk-updated (only the Tauri family is rewritten; the rest is reported); script fixes run
only with `--apply-fixes`; unmatched failures become an agent brief, not a guess. Verification stays with the lead
through `scripts/build/rust/cargo-serial.sh`. A weekly report-only run is in `.github/workflows/deps-sync.yml`.

## Whole-repo inventory

`deps-sync inventory` (about 45 s, six-hour response cache in `target/deps-inventory/cache`) scans every manifest and
lockfile and writes `docs/reference/workspace/DEPS-INVENTORY.md` (the full JSON stays in `target/`):

- Rust: `Cargo.lock` against the crates.io sparse index (latest, yanked); git sources through `git ls-remote`, so any
  host works (GitHub, GitLab, googlesource); first-party crates checked for version drift and crates.io name collisions.
- Bun: `bun.lock` resolved versions against the npm registry (latest, deprecated).
- Python: `requirements*.txt` and `uv.lock` under the repository and `inventory.pythonRoots` in `config/deps/watch.json`,
  against PyPI (latest, yanked).
- Security: one OSV.dev batch query over the resolved crates.io, npm and PyPI versions (RUSTSEC, GHSA, PYSEC).

Go modules, Maven and other registries are not present in this repository; add a collector in
`deps-inventory.ts` when one appears.
