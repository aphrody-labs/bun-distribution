<!-- SPDX-License-Identifier: Apache-2.0 -->
# Handoff: GitHub, SQL convergence and data dedup (session 2026-10-01)

> Contexte courant (2026-10-09) : développement et builds selon l'hôte, la cible et les ressources disponibles ; aucun produit n'est réservé à un poste. Voir le [contexte](../../operations/workspace/windows-native.md).


Compacted state of one Claude lead session and its background workers, so
Codex or agy can finish if the lead stops. Rules: [AGENTS.md](../../AGENTS.md)
(owner directives section is binding). Claim:
`.coord/claims/sql-convergence.json` (not in repo).
Decision record: [decisions/infra/sql-convergence.md](../../decisions/infra/sql-convergence.md).
IEVR/IECODE side: `~/iecode/docs/development/AGENT-HANDOFF-2026-10-01.md`.

## Owner directives (binding, recorded in AGENTS.md and agent memory)

- Never commit under an agent/model name; no `Co-Authored-By`/"Generated with"
  trailers. Commit identity `aphrody-code <contact@aphrody.com>`.
- No AI app/bot on GitHub repos or orgs; no AI mentions in public products
  (site, bot, non-dev apps, SEO); never publicly detail internal libs, MCP,
  skills, plugins or architecture.
- Every GitHub repo stays private until development ends; non-commercial dev
  phase; all licences acceptable for now, decided at distribution.
- YOLO / no human in the loop, but respect docs/coord/monorepo/infra/workspace
  conventions (docs/<category>/<domain>, scripts/<category>/<domain>,
  crates|packages/<domain>/<name>, claims in `.coord`, workers through
  `aphrody a2a invoke --peer <p> --claim <path>`). Workers never run Cargo; the
  lead uses `scripts/build/rust/cargo-serial.sh`.

## Done and verified

| Area | State |
|---|---|
| GitHub accounts | `aphrody-dev` = owner account; `aphrody-code` = legacy account. Both in `gh` on WSL, vps, dbfr. Claude Code MCP servers `github-aphrody-code`/`github-aphrody-dev` (user scope, token via `gh auth token --user`, currently disabled for this project via `/mcp`). |
| Repo transfers | 15 `aphrody*` repos transferred from `aphrody-code` to `aphrody-labs` (aphrody, -ai, -os, -ui, -web, -shell, -infra, -compat, -contracts, -native, -discord, -src, -py, -ts, -go). Others (shenron, nie, iecode, bxc, forks…) remain under `aphrody-code`. |
| Visibility | 28 public repos set private (aphrody-code ×22, aphrody-labs ×6, rose-griffon/canvas). |
| SSH/Git | Keys `~/.ssh/github_aphrody_dev` (registered on aphrody-dev, auth + signing) and `~/.ssh/github_aphrody_code` (NOT registered: token lacks `admin:public_key`). Aliases `github-dev`/`github-code`; agent socket `~/.ssh/agent.sock` loaded from `~/.bashrc`. Global `url.insteadOf`: `https://github.com/{aphrody-labs,rose-griffon}/` → `git@github-dev:`. the monorepo is published privately as **`aphrody-labs/aphrody`** (created by Codex as `aphrody-workspace`, renamed by owner decision; local remote `workspace`); the older unrelated `aphrody-labs/aphrody` history was renamed `aphrody-labs/aphrody-legacy` and archived (local remote `legacy-aphrody`); `../aphrody-py` origin → `aphrody-labs/aphrody-py`. `tools/config/stack-training.json` URLs updated for transferred repos. |
| Neon | Project `aphrody` (id `nameless-poetry-16498628`, org `org-long-shape-78978832`, branch `production`, PG18, Free plan 1 GiB/branch). **Database intentionally empty** (owner: no schema before code + migrations). Root `neon.ts` (7-day TTL experiment branches), `.neon/` ignored, `@neon/config`+`@neon/env` in root package.json. Env `APHRODY_TRAINING_DATABASE_URL[_POOLED]` in ignored root `.env`. Neon skills in `.claude/skills/neon*` and `.agents/skills/` (not in repo) (untracked); Neon MCP installed for claude-code, codex, antigravity, gemini-cli, zed (API key id 3383804). |
| Supabase cloud | Org `aphrody` has no project; none will be created (ADR D2). |
| MCP permissions | `~/.claude/settings.json` allows `mcp__Neon`. |
| WSL PostgreSQL | Cluster `18/main` started (port 5432, pgvector 0.8.6 etc.); `16/main` stopped. |
| vps hardlinks | bxc-crawls v2/v3 → v4 `bxc.sqlite`; restore copy of `aphrody-2026-09-25.dump` → `/var/backups/postgres` copy. |
| Research | [docs/research/ai/sqllm/](../../research/ai/sqllm/README.md) (8 sourced files; top-10 in recommendations.md). |
| ADR | [decisions/infra/sql-convergence.md](../../decisions/infra/sql-convergence.md) D1–D14, D3 amended: keep only `rg` (vps) and `shenron_site` (dbfr). |
| Comparison tool | `bun run db:compare` → `scripts/audit/infra/db-compare/` (TS7-clean, Bun native + Web APIs, read-only over ssh). Report `~/.aphrody/private/reports/db-compare-rg-shenron-2026-10-01.json`. Result: best RG SQLite `vps:/srv/rg/shared/discord-sync/discord.db`; best Shenron SQLite `vps:/srv/shenron/shared/bot/data/bot.db` (638 522 rows, fresher than dbfr's 602 702); freshest db packages are the repo copies `@rosegriffon/db@1.0.3` and `@shenron/db@0.1.0`; no shared deps, 5 homonymous modules (bun-sql, env, index, redis, types). |

## In flight at handoff (background workers; verify before continuing)

Each worker reports in its own files; check them, do not assume success.

1. **Data dedup + unique backups + DB retirement — DONE.** Report:
   `docs/operations/infra/db-dedup-2026-10-01.{md,json}`, helpers in
   `scripts/tools/infra/db-dedup/`. Unique backups verified (`sha256sum -c`) at
   `/var/backups/aphrody-unique/2026-10-01/` on vps and dbfr and mirrored to WSL
   `~/.aphrody/private/backups/aphrody-unique/2026-10-01/`. Reclaimed ≈2.5 GB vps,
   ≈1.8 GB dbfr. Dropped `stack`, `achillea`, `aphrody`, `aphrody_web` (vps) and
   `aphrody`, `aphrody_web`, `stack`, `vps_postgres` + cluster 16 (WSL) after
   final dumps; only `rg` and `shenron_site` remain. Leftovers for the owner:
   dbfr replica `bot.db` still read by `shenron-sqlite-replica-backup` timer;
   five stale env files on vps (/etc/aphrody/aphrody-ai-http.env,
   aphrody-site.next.env, aphrody-web-api.next.env,
   /etc/rose-griffon/achillea-auth.env, achillea.env.bak.*); `pg_net` still in
   vps `shared_preload_libraries` (remove at next PG restart);
   `docs/operations/infra/IMMUTABLE-RELEASES.md` points at a removed restore dir;
   `~/.aphrody/private/backups/legacy-supabase-vps/` duplicate can go.
2. **WSL Supabase dev stack — DONE.** Docker Engine 29.8.2 + Compose 5.5.1;
   stack `~/.aphrody/services/supabase` (upstream `self-hosted/v0.8.2`, commit
   `564eab8a`, Kong option + Logflare/Vector), 13 services healthy, user unit
   `aphrody-supabase.service` + `start.sh`, ports 127.0.0.1: Kong 54321/54443,
   DB 54322, Supavisor 54328/54329. Legacy RG Supabase dump (PG17.6, 2026-08-10)
   restored: 144 tables, 187 930 rows, 0 mismatches; 31 auth users. Gaps:
   storage object bytes were never backed up (6 456 records, downloads 500);
   vault secrets not restorable; `rg-before-achillea` dump kept as backup only.
   Doc: `docs/operations/infra/supabase-wsl-docker.md`.
3. **Rust — DONE and validated by the lead** (cargo-serial): `aphrody-sql`
   (`crates/infra/sql`), `aphrody-train` feature `registry`
   (`migrations/0001_registry.sql`, `src/registry.rs`), consumers rag/mcp/memory,
   CLI `aphrody train registry-migrate` (`crates/infra/aphrody` feature `train` now enables
   the registry). Checks green; tests: aphrody-sql 35, aphrody-train 14,
   aphrody-rag 52, aphrody-memory 90. Registry schema applied to Neon
   `aphrody` production after a branch rehearsal (idempotent re-run verified).
   Reference: `docs/reference/ai/TRAINING-REGISTRY.md`, `crates/infra/sql/README.md`.
4. **Bun — DONE.** `packages/infra/sql` (`@aphrody/sql`: env, postgres via
   Bun.SQL with TLS/pooler rules, redis via Bun `RedisClient`, sqlite policy +
   sqlite-vec, `vacuumInto`); `@rosegriffon/db` and `@shenron/db`
   `bun-sql`/`env`/`redis` delegate with unchanged contracts;
   `iecode/apps/rg/website/next.config.ts` transpiles `@aphrody/sql`; npm sqlite-vec
   `^0.1.9` in shenron pipeline + bot; `bun.lock` updated. Gates: bun test
   33/12/78 pass, tsgo clean ×3, oxlint clean except 16 pre-existing findings in
   `iecode/packages/rg/db/src/redis.ts`, `monorepo:layout` OK (85 packages). Note:
   `@rosegriffon/db` still has a public `publishConfig` and now depends on the
   private `@aphrody/sql` — do not publish (owner rule: everything private).
5. **Python — DONE** (`../aphrody-py/packages/ai/py/aphrody-train`): hashing,
   hash anti-join leak gate, MinHash clustering before splits, mined hard
   negatives with positional fallback; 44 tests pass. sentence-transformers 6.1
   lives in a new `mine` extra (the `full` extra stays on 5.7 because the ONNX
   export stack caps transformers < 4.58). Follow-up: the Rust runner should pass
   `--extra mine` for `TrainKind::Triples` and may type the new optional
   `done.stats` field.

6. **IEVR → IECODE — DONE (uncommitted in both repos).** IECODE is the only
   owner of inagle, inagle-cross, azalee, zukan/NIE scripts and IEVR docs; Aphrody
   consumes `../iecode/packages/{inagle,inagle-cross,azalee}` as Bun workspace
   members (`iecode/docs/rg/decisions/ievr-packages-from-iecode.md`, map
   (removed import receipt)). RG website production build
   passes; bot 1 264 tests pass; IECODE inagle 136 + azalee 282 tests pass.
   Follow-ups: `iecode/scripts/rg/assemble-vps-release.sh` must bundle IECODE packages at
   a pinned revision; dangling doc links (plugin skills nie-*,
   docs/migration/IMPORTED-DOCS-INDEX.md); IECODE `bun.lock`/`docs.7z` for Codex.

## Remaining steps for whoever continues (in order)

1. Read the worker outputs above; fix or finish any partial item.
2. Lead-only Cargo validation, one command at a time:
   `scripts/build/rust/cargo-serial.sh check -p aphrody-sql`, then `-p aphrody-train --features registry`,
   `-p aphrody-rag`, `-p aphrody-mcp`, `-p aphrody-memory` (confirm package names in each Cargo.toml),
   then their tests; fix errors in place.
3. Bun gates: `bun test` in packages/infra/sql, packages/rg/db, packages/shenron/db;
   `bun run monorepo:layout`; `bun run db:compare` still green.
4. Only after 2–3 pass: rehearse `crates/ai/train/migrations/0001_registry.sql`
   on a Neon TTL branch (`neon checkout <name> --create`), then apply to
   `production` with `APHRODY_TRAINING_DATABASE_URL` (direct).
5. Update `.coord/claims/sql-convergence.json` (not in repo) state, then one integrating
   agent commits by scope (no AI trailers), e.g. `docs(infra): …`,
   `feat(infra): aphrody-sql …`.
6. Still blocked on the owner (needs a browser device flow):
   `gh auth refresh -h github.com -u aphrody-code -s admin:org,admin:public_key`
   → then invite `aphrody-dev` as owner of `rose-griffon`
   (`PUT orgs/rose-griffon/memberships/aphrody-dev role=admin`, accept with the
   aphrody-dev token) and register `~/.ssh/github_aphrody_code.pub`.
7. Open questions for the owner: transfer the remaining `aphrody-code` repos
   (shenron, nie, iecode, bxc, …) to `aphrody-labs`? Rotate the Neon password
   that appeared in the session transcript. 4 historical commits carry AI
   `Co-Authored-By` trailers (history rewrite not done).

## Final state (2026-10-02) — read this first

Owner delegated every project to Claude, Codex and agy (full YOLO, no human in
the loop). Binding rules: private repositories, no AI trailers/apps/public
mentions, no publication, **no duplicate anywhere** (repos, backups, files),
no WSL work until Aphrody is deployed.

**Done and pushed** (aphrody-labs/aphrody `main`, aphrody-py `main`):
SQL convergence (`aphrody-sql`, `@aphrody/sql`, training registry on Neon
`aphrody`), IEVR moved to IECODE, `@aphrody/paths`, env catalogue, developer
bootstrap, native RAG backend, upstream docs (text only), attribution and
public-surface audits, single plugin source `plugins/aphrody`, Codex marketplace
served from the monorepo, 37 packages marked private.

**GitHub** (`docs/reference/infra/GITHUB-OWNERSHIP.md`): `aphrody-labs` holds only
`aphrody`, `aphrody-py`, `iecode`, `oxc`, `bun`; 29 duplicate repositories were
deleted after verified backups; `dot-aphrody` is under `aphrody-code`;
`aphrody-dev` owns the org and has no repository.

**Backups**: one copy only, `~/.aphrody/private/backups/aphrody-unique/<date>/`
(sha256 set) and `~/.aphrody/private/backups/github/aphrody-labs-2026-10-01/`
(15 GB, includes the 7.5 GB bxc release assets). Nothing on vps, dbfr or C:.

**Deduplicated**: 339 Shenron script mirrors, 129 docs copies, plugin copies
(259 doc files), `py/aphrody-train` (not in repo), 236 UI binaries (staged by `build.rs`), 93
shared site assets (generated from `@shenron/ui` and `@rosegriffon/assets`);
dbfr 26 GB of media identical to vps; vps leftover checkouts.

**Open, in order**:
1. aphrody-code mirrors of third-party projects (38 repos: tauri, bevy, iced,
   puppeteer, …): `/tmp/mirror-verdict.tsv` records, per repo, how many refs are
   not in upstream. Delete only repos with `not-upstream=0`, then repoint
   `tools/config/tauri-upstream.json` at the upstream URLs. Keep `challonge`,
   `voiranime`, `worldbeyblade`, `xai`, `x`, `x-client` (RG `config/rg` (not in repo)
   dependencies) and every repo with local commits. `YOLO` is 63 % identical to
   `plugins/aphrody` (111 of 175 files): review the other 64 before deleting.
2. agy (UI/M3/Tauri, in the monorepo): resolve the 11 `retained-duplicate`
   items (no copy allowed), report remaining exact-duplicate groups = 0.
3. IECODE/RG integration: published ranked namespace/telemetry corrections
   (`402365df1`, `a88892805`) and producer/consumer catalog contracts
   (`92e027f6` in IECODE, `d7feb4c5d` here). The twin checkout now pins
   `92e027f647744ba20be55a18b992400131ad2eca` because Inagle changed.
   Clean installed website typechecking and 402 tests pass; four disposable
   PostgreSQL fixture tests pass, without production schema mutation.
   RG production build, complete CI and deployment remain open. Imported RG
   agent documents are historical references, not local execution contracts.
4. Parked in `git stash` (do not restore early): WSL build family (owner rule),
   llama-server `in_process` (does not compile).
5. Owner-only: `gh auth refresh -h github.com -u aphrody-code -s
   admin:org,admin:public_key` then invite `aphrody-dev` as `rose-griffon` owner
   and register `~/.ssh/github_aphrody_code.pub`; rotate the Neon password;
   4 historical commits with AI trailers (`aphrody git attribution` lists them,
   rewriting needs a force-push).
6. Data leftovers: vps `rg` nightly dumps keep newest only; dbfr
   `~/shenron/apps/bot/data` is a stale bot.db replica (timer
   `shenron-sqlite-replica-backup`); lost without copy: vps `root.env` in the
   removed `.rg-deploy-stage`.
