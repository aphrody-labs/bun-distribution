<!-- SPDX-License-Identifier: Apache-2.0 -->
# Inventory: `py/` against the rest of the Aphrody monorepo

> Historical inventory: the batches below describe the 2026-10-05 layout. Since 2026-10-09, [the Python/Bun plan](../python-bun/PLAN.md) assigns native Python ownership to the Bun fork. Removed Aphrody paths are marked `not in repo`; original hashes, counts and decisions are retained as dated evidence.

> Contexte courant (2026-10-09) : développement et builds selon l'hôte, la cible et les ressources disponibles ; aucun produit n'est réservé à un poste. Voir le [contexte](../../operations/workspace/windows-native.md).


Date: 2026-10-05. Scope: the 399 tracked files under `py/` against every other tracked
file of the repository. Owner directive: `py/` is fused into Aphrody (the former rule that
Python keeps its own repository and store is lifted for `py/`); see [PLAN.md](PLAN.md).

## Method

Read-only, reproducible with the Rust/Bun tools only:

| Step | Command | Result |
| --- | --- | --- |
| Exact duplicates | `git ls-files -s` grouped by blob hash (Bun script) | 4 blob groups shared between `py/` and the rest (table rows I-01..I-04) |
| Near duplicates | 4-line shingles of trimmed lines, every tracked text file outside `vendor/`, `docs/reference/`, locks (Bun script) | 377 `py/` files compared with 9 991 others; 26 files with at least 30 % coverage |
| Tree fingerprint | `yolo scan py --json` | 377 files on disk (excluding caches), 7 048 581 bytes, 99 664 lines, `treeFingerprint` `8f8ebbfcf6e0a333` |
| Manifests | `aphrody scan manifests --root py` and a name scan of every tracked `Cargo.toml`/`pyproject.toml` | the only duplicated identity is the Rust crate `aphrody-rust` (item I-06) |
| Identity of CLIs | `aphrody ovh --help`, `aphrody ovh dns --help`, `packages/engine/yolo/src/python.ts` | items I-11 and I-12 |

Relations: `identical` (same blob), `near` (same content up to mechanical edits),
`superseded` (a capability owner elsewhere covers it), `unique` (no counterpart).
Decisions: `delete`, `alias`, `merge`, `keep` (unique Python product code), `stage` (documented
for a later batch). The column "batch" refers to the commit batches of the owner request
(B = absorb native, C = deduplicate).

## Table

| ID | `py/` path | Aphrody path | Relation | Decision | Batch | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| I-01 | `py/{apps/meetings,packages/aphrody,packages/cli,packages/model-tools}/LICENSE` (4 files) | `crates/ml/LICENSE-APACHE` | near (Apache-2.0 text, one line less) | keep per package (a wheel must carry its own licence file; `license-files` is enforced by `tools/packaging` (not in repo)) | - | blob `d645695673` x4 vs `29f81d812f`; 11 358 vs 11 558 bytes |
| I-02 | `py/packages/{aphrody-train,embedding-fixtures}/LICENSE` | `crates/ui/LICENSE` (+ 3 more) | identical | keep per package (same reason as I-01) | - | blob `d9a10c0d8e`, 10 173 bytes |
| I-03 | `py/packages/{aphrody-train,embedding-fixtures}/NOTICE` | (removed import receipt) | identical | keep (wheel notice) | - | blob `48085567fe`, 606 bytes |
| I-04 | py/packages/os/drive/LICENSE | `crates/os/kernel/comps/drive/LICENSE` | identical | delete with I-05 | C, done | blob `5dba2778c7`, 4 622 bytes |
| I-05 | `py/packages/os/drive/adapters/*/sync.py` (11 adapters) and `README.md` | `crates/os/kernel/comps/drive/adapters/*/sync.py` and `README.md` | near (the `py/` copy is a ruff `UP`-modernised variant: `datetime.UTC`, `X | None`; coverage 0.79 to 0.93, same line counts within 2) | superseded: delete the `py/` copy; the Rust crate owns the adapters that its sync engine executes | C, done | e.g. slack `d7fd9834bb` vs `6d3d491843` (224 vs 224 lines), gmail 499 vs 498, opencode 351 vs 353; the `py/` ruff config already excludes packages/os/drive; no consumer outside `py/` and the migration records references py/packages/os/drive |
| I-06 | py/packages/aphrody/native/ (`Cargo.toml`, `Cargo.lock`, `source.json`, `source.tar.gz`, `.gitignore`, generated `src/`) | `crates/ai/rag-python` (not in repo) (+ `crates/ai/rag-core`) | identical sources, duplicate crate identity `aphrody-rust` | absorb: `crates/ai/rag-python` (not in repo) is the single owner, `py/` builds it by path | B, done | `fusion.rs` `0eb7f5ffda`, `vectors_f32.rs` `1932a3b077`, `vectors_f64.rs` `3f2e6d9f20` byte-identical to `crates/ai/rag-core/src`; `lib.rs` differs only by the 4 packaging lines (`extern crate self as aphrody_rag_core; pub mod fusion; pub mod vectors_f64; pub mod vectors_f32;`, 10 241 vs 10 144 bytes); PyO3 `0.29.0` there vs `0.29` (locked `0.29.3`) in the workspace |
| I-07 | py/packages/aphrody/build_backend.py, `tests/test_build_backend*.py`, `tests/test_pin_rag_source.py`, `tools/packaging/pin_rag_source.py` (not in repo) | - | superseded by I-06 | delete (they only verify the source projection archive) | B, done | `build_backend.py` 283 lines verifies `source.tar.gz` SHA-256 and rewrites SBOM refs |
| I-08 | `py/tools/packaging/qualify_aphrody.py`, `qualify_extras.py`, `qualify_ai_resources.py`, `py/tools/sdk/verify-wheel.py`, `test_qualify_aphrody.py` | - | rewritten for the in-tree build | rewritten for the in-tree build (they also cloned a `py/` repository that no longer exists) | B, done | they stage `native/source.*` and rebuild from an sdist; the sdist is no longer self-contained |
| I-09 | `py/.github/{workflows,ISSUE_TEMPLATE,pull_request_template.md}` (5 files) | `.github/workflows`, `scripts/tools/infra/github-templates.ts`, `tools/config/github/templates.json` | dead nested config (GitHub reads only the root `.github`); `feature_request.yml` is near a template generated by `github-templates.ts` (coverage 0.77) | delete | C, done | root `.github` holds 2 workflows and no Python workflow; commit `d9f4ba21e` already removed other dead nested workflows |
| I-10 | `py/{AGENTS,GOAL,PLAN,TODO,MEMORY,README}.md` | root `AGENTS.md`, `GOAL.md`, `PLAN.md`, `TODO.md`, `MEMORY.md`, `README.md`, `CLAUDE.md` | superseded rules (they name `../aphrody`, `../yolo`, `../iecode` checkouts and a standalone `aphrody-py` repository) | `AGENTS.md`, `TODO.md`: deleted; `GOAL.md` and `MEMORY.md` (13 382 bytes of dated evidence): moved to `docs/migration/python/` (not in repo) (former migration-record directory); `PLAN.md` and `README.md`: kept, repository statements rewritten | C, done | sizes 1 707 / 2 008 / 720 / 13 382 / 3 318 / 3 570 bytes |
| I-11 | py/tools/infra/scripts/ops/ovh.py | `aphrody ovh dns` (`crates/infra`) | superseded | delete | C, done | 6 392 bytes of Python covering `zones`, `zone`, `export`, `records`, `add`, `delete`, `refresh`; `aphrody ovh dns --help` lists `zones info records add delete refresh set-a audit export backup` |
| I-12 | `py/tools/workspace/{cli,supervisor,fixture}.ts` (+ 2 tests, 5 files, 400 lines) | `packages/engine/yolo/src/python.ts` (`yolo py status\|test\|lint\|fmt\|build`, 176 lines) | overlap: two Bun entry points for the Python toolchain, `yolo py` only targets `packages/engine/python` | merge: `yolo py` targets the `py/` uv workspace; the nested py/package.json (removed 2026-10-06) workspace identity `aphrody-py-workspace` and py/tsconfig.json (removed 2026-10-06) go away once the scripts move | C (stage) | py/package.json (removed 2026-10-06) declares 11 scripts calling `tools/workspace/cli.ts` (not in repo); root `package.json` workspaces do not list `py/` |
| I-13 | `docs/products/ai/py/{aphrody,aphrody-train}/README.md` | `py/packages/{aphrody,aphrody-train}/README.md` | near, stale (older command names `aphrody <command>`, missing "Linux is the supported platform") | delete the 2 stale READMEs and the `blender_addon` copy; keep `antigravity-sdk-python/*` (upstream fork docs without a counterpart) | C, done | `py/packages/aphrody/README.md` 8 234 bytes, coverage 0.48 |
| I-14 | `py/docs/migration/python-packaging-qualification.json` | (removed import receipt) | near (0.81) | keep (dated provenance; excluded from product-residue) | - | historical records are not live inputs |
| I-15 | `py/docs/migration/locks/ai/py/{uv.lock,aphrody-train/uv.lock}` | `py/packages/aphrody/uv.lock`, `py/packages/aphrody-train/uv.lock` | historical lock snapshots (blobs differ: `ab50954ff3`, `4cca24d2fa` vs `1733784b28`, `e6fda39ec0`) | keep (provenance) | - | the live locks are the member locks and `py/uv.lock` (`f4a9248abf`), required by `modernize_workspace.py locks` |
| I-16 | `py/packages/aphrody/src/aphrody/cli/*.py` (14 shims), `google_cli.py`, `pipeline_meeting.py` | `py/packages/cli/src/aphrody_cli`, `py/apps/meetings` | alias (compatibility facades, 14 lines each) | keep (public import compatibility) | - | each re-exports `aphrody_cli.*` / `aphrody_meetings.pipeline` through `sys.modules` |
| I-17 | `packages/engine/python` (`yolo` Python package, PyO3 crate `crates/engine/yolo-pyo3` (not in repo)) | `py/` workspace | second Python workspace and second PyO3 module crate | stage: converge on the single `vu` runtime (see PLAN section 6); track nothing generated | D | tracked build output `packages/engine/python/python/yolo/_yolo_native.cpython-314-x86_64-linux-gnu.so` (not in repo) (the only tracked `.so`/`.pyd` in the repository) |
| I-18 | `py/var/runs/*/manifest.json` (17 files) | - | tracked run receipts (generated output) | delete from the index and ignore `py/var/` (not in repo) | C, done | produced by `aphrody` run receipts, content `Status { host: Vps }` |
| I-19 | py/.gitmodules, py/.codex/config.toml, `py/.gitattributes`, `py/.gitignore`, `py/.python-version` | root `.gitmodules`, `.gitattributes`, `.gitignore` | `.gitmodules` points at vendor/gemma, vendor/gemma-tuner-multimodal, vendor/jan, removed on 2026-10-05; `.codex/config.toml` enables a plugin; `.gitattributes` is a subset of the root one | delete `.gitmodules` and `.codex/config.toml`; keep `.gitignore` and `.python-version` (uv reads it) and `.gitattributes` (Git honours nested attribute files; the rules are not in the root file) | C, done | py/.gitmodules 372 bytes, none of the three paths exists |
| I-20 | py/config/sibling-checkouts.json (removed 2026-10-06) | `tools/config/vendor.json`, `tools/config/upstream-sources.json` | superseded (pins a `yolo` SDK archive by sha256 and a sibling checkout path) | stage: remove with the SDK-archive channel (PLAN section 7) | C (stage) | 507 bytes |
| I-21 | `py/tools/packaging/modernize_workspace.py` | - | one-time migration (`apply`) plus live gates (`check`, `locks`, `distributions`, `providers`, `linux-sdk`) in one 2 259-line file; `apply` rewrites docs from embedded templates | stage: split the live gates from the migration, then delete the migration half | C (stage) | functions `migrate_*` (lines 129-1445) versus `isolated_distributions`, `locks`, `main` |
| I-22 | `py/tools/infra/scripts/{install-developer-cli,smoke-aphrody-stack-local}.py and the removed python-workspace-dispatch.py`, `rg/*.py` | `aphrody package`, `scripts/release/atomic-deploy-aphrody-stack.sh`, `packages/infra/workspace/src/consolidation.ts` | partial overlap (consumers call these paths) | keep until the consumers are repointed | - | `scripts/release/atomic-deploy-aphrody-stack.sh` names `smoke-aphrody-stack-local.py --attest` |
| I-23 | `py/tools/ai/scripts/*.py` (10), `py/tools/ui/scripts/process_assets.py` | `scripts/tools/ai/scripts/*.ts` (benchmarks, different capabilities) | unique | keep | - | no shingle overlap above 0.3 except `process_assets.py` vs `assets/ui/manifest.json` (0.30, data not code) |
| I-24 | `py/packages/aphrody/src/aphrody/{gemini_web,session_db,antigravity_bridge,voice_server,web_browser,forensic/*,whisper...}.py`, `py/packages/aphrody-train` | `crates/google/gemini-web`, `crates/ai/session`, `crates/google/antigravity`, `crates/ai/train` | independent re-implementations of Rust capability owners | keep (unique Python product code); port candidates once Rust parity is evidenced | - | no byte or shingle overlap; names overlap only |
| I-25 | `py/packages/aphrody/src/aphrody/rag/{math,vectors}.py`, `_rag_vectors.py` | `crates/ai/rag-core/src/{fusion,vectors_f32,vectors_f64}.rs` | already thin adapters: arithmetic is delegated to the native module | keep | - | `rag/math.py` states "All calculations belong to aphrody-rag-core" |
| I-26 | `py/packages/{aphrody,aphrody-train,cli,embedding-fixtures,model-tools}`, `py/apps/meetings` | - | unique Python product code | keep in place; `model-tools` and `aphrody-train` are under the claim `purge-aphrody` and are left to it | - | 284 `.py` files, 56 204 lines |

## Totals (after batches B and C, 2026-10-05)

| Class | Files | Action |
| --- | --- | --- |
| Native projection (I-06, I-07) | 5 tracked files in `native/`, `build_backend.py`, 3 tests, `pin_rag_source.py`, `test_modernize_workspace.py`, plus the generated `native/src/` | removed in batch B (commit 47d2681b5) |
| Superseded or dead (I-04, I-05, I-09, I-11, I-13, I-18, I-19) | 42 tracked files: 13 Drive adapter files, 5 nested `.github`, 17 run receipts, 2 stale READMEs, 5 meta/config files (`.gitmodules`, `.codex/config.toml`, `ovh.py`, `AGENTS.md`, `TODO.md`) | removed in batch C |
| Moved (I-10) | 2 | `GOAL.md`, `MEMORY.md` to `docs/migration/python/` (not in repo) (former migration-record directory) |
| Staged (I-12, I-17, I-20, I-21, I-22 and the sibling-repository wiring of PLAN section 9) | - | listed in [PLAN.md](PLAN.md) |
| Keep (unique Python product code) | the rest | unchanged |

Untracked weight on disk (7.7 GB at the start of the session: `.venv`, `.cache`, `.ruff_cache`,
`.pytest_cache`, `__pycache__`, `dist`, and the compiled `aphrody_rust.abi3.so` of 790 160 bytes)
is not repository content and is ignored by `py/.gitignore`.

## Remaining references to the former repository

`rg aphrody-py` finds the former standalone repository wired into: `tools/config/update/pins.json`,
`tools/config/google-stack-release.json`, `tools/config/docs/documentation.json`, `tools/config/github/templates.json`,
`tools/config/ai/agent-plugin-providers.json`, `tools/config/deps/watch.json`, `tools/config/build-factory.json`,
`tools/config/host/toolchain.json`, `tools/config/commit-sync.json`, `packages/engine/core/src/units/catalog.json`,
`scripts/dev/{bootstrap,clone-and-bootstrap}.{sh,ps1}`, `scripts/tools/shell/setup.{sh,ps1}`,
`GOAL.md` (claimed by another session) and py/package.json (removed 2026-10-06). They are host and factory catalog entries:
they change through Infra's catalog and runbook (plan before apply), so they are staged, not edited here
(PLAN section 9).
