<!-- SPDX-License-Identifier: Apache-2.0 -->
# Handoff: GitHub, SQL convergence and data dedup (session 2026-10-01)

Compacted state of one Claude lead session and its background workers, so
Codex or agy can finish if the lead stops. Rules: [AGENTS.md](../../../AGENTS.md)
(owner directives section is binding). Claim:
[`.coord/claims/sql-convergence.json`](../../../.coord/claims/sql-convergence.json).
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
| SSH/Git | Keys `~/.ssh/github_aphrody_dev` (registered on aphrody-dev, auth + signing) and `~/.ssh/github_aphrody_code` (NOT registered: token lacks `admin:public_key`). Aliases `github-dev`/`github-code`; agent socket `~/.ssh/agent.sock` loaded from `~/.bashrc`. Global `url.insteadOf`: `https://github.com/{aphrody-labs,rose-griffon}/` → `git@github-dev:`. the monorepo is published privately as **`aphrody-labs/aphrody`** (created by Codex as `aphrody-workspace`, renamed by owner decision; local remote `workspace`); the older unrelated `aphrody-labs/aphrody` history was renamed `aphrody-labs/aphrody-legacy` and archived (local remote `legacy-aphrody`); `../aphrody-py` origin → `aphrody-labs/aphrody-py`. `config/stack-training.json` URLs updated for transferred repos. |
| Neon | Project `aphrody` (id `nameless-poetry-16498628`, org `org-long-shape-78978832`, branch `production`, PG18, Free plan 1 GiB/branch). **Database intentionally empty** (owner: no schema before code + migrations). Root `neon.ts` (7-day TTL experiment branches), `.neon/` ignored, `@neon/config`+`@neon/env` in root package.json. Env `APHRODY_TRAINING_DATABASE_URL[_POOLED]` in ignored root `.env`. Neon skills in `.claude/skills/neon*` and `.agents/skills/` (untracked); Neon MCP installed for claude-code, codex, antigravity, gemini-cli, zed (API key id 3383804). |
| Supabase cloud | Org `aphrody` has no project; none will be created (ADR D2). |
| MCP permissions | `~/.claude/settings.json` allows `mcp__Neon` and `mcp__plugin_supabase_supabase`. |
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
   CLI `aphrody train registry-migrate` (`apps/cli` feature `train` now enables
   the registry). Checks green; tests: aphrody-sql 35, aphrody-train 14,
   aphrody-rag 52, aphrody-memory 90. Registry schema applied to Neon
   `aphrody` production after a branch rehearsal (idempotent re-run verified).
   Reference: `docs/reference/ai/TRAINING-REGISTRY.md`, `crates/infra/sql/README.md`.
4. **Bun — DONE.** `packages/infra/sql` (`@aphrody/sql`: env, postgres via
   Bun.SQL with TLS/pooler rules, redis via Bun `RedisClient`, sqlite policy +
   sqlite-vec, `vacuumInto`); `@rosegriffon/db` and `@shenron/db`
   `bun-sql`/`env`/`redis` delegate with unchanged contracts;
   `apps/rg/website/next.config.ts` transpiles `@aphrody/sql`; npm sqlite-vec
   `^0.1.9` in shenron pipeline + bot; `bun.lock` updated. Gates: bun test
   33/12/78 pass, tsgo clean ×3, oxlint clean except 16 pre-existing findings in
   `packages/rg/db/src/redis.ts`, `monorepo:layout` OK (85 packages). Note:
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
   members (`docs/decisions/rg/ievr-packages-from-iecode.md`, map
   `docs/migration/ievr-to-iecode-2026-10-01.json`). RG website production build
   passes; bot 1 264 tests pass; IECODE inagle 136 + azalee 282 tests pass.
   Follow-ups: `scripts/rg/assemble-vps-release.sh` must bundle IECODE packages at
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
5. Update `.coord/claims/sql-convergence.json` state, then one integrating
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

## Integration status (2026-10-01, end of session)

Steps 1–5 are done. Aphrody `a2c040ba8..a8a721559` and aphrody-py
`fa4d504..a555238` are pushed to `aphrody-labs` under `aphrody-code`, without
AI trailers. The lead also integrated the orphan work left by earlier sessions:
native RAG backend, `@aphrody/paths`, `.env.example` catalogue, developer
bootstrap, IECODE follow-up for RG, plugin paths and OpenCode config, LiteLLM
decision. It restored `publish = false` on 147 manifests (no publication
without an owner decision).

Parked in `git stash` (do not restore without the noted condition):

- `aphrody wsl-build` and the WSL/Ubuntu distro builds: owner rule, touch WSL
  only once Aphrody is deployed.
- `aphrody-llama-server` `in_process` module: does not compile with the
  `in-process` feature.

Left uncommitted, waiting for an owner decision:

- `packages/infra/workspace/src/git-attribution.ts` and `aphrody git
  attribution`: history rewriter that strips every `Co-Authored-By` (human
  ones included) and rewrites authors to `aphrody-dev`, while the rule says
  `aphrody-code`.
- `clean-public-ai` scanner and the RG e-mail changes: the scanner's
  personal-address rule forced `rosegriffonfr@gmail.com` →
  `contact@aphrody.com` in RG mediation, info and Patreon admin access, which
  is an authorization change.
- Bulk upstream documentation import (`consolidation.ts`,
  `docs/migration/{IMPORTED-DOCS-INDEX.md,document-import.json,source-map.json}`,
  10 653 untracked files under `docs/*/upstream-*`, about 54 MB): includes
  GPL-2.0 kernel docs, a whole website (jan) and upstream
  `AGENTS.md`/`CLAUDE.md` files that agents would load as instructions.
