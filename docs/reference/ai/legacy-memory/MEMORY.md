# Memory index — aphrody monorepo (Claude Code)

Snapshot: **2026-09-05**, taken in the retired `aphrody` monolith (archived); this
repository is now `aphrody-ai`. Treat the closeout notes below as history.

## Repository closeout (2026-09-05)

- Git history was intentionally consolidated into the single root commit
  `30d3da03` (`chore: consolidate repository history`) and force-with-lease
  pushed to `origin/main`; local and remote `main` are synchronized.
- Generated local artifacts `target/` and `node_modules/` were purged. Git
  reflogs and unreachable objects were expired and garbage-collected.
- `.coord/` remains intentionally untracked and must not be deleted.
- No documentation was deleted because no candidate was unambiguously
  obsolete without risking valid references.
- The global Codex profile uses `approval_policy = "never"` and
  `sandbox_mode = "danger-full-access"`; Aphrody remains local-model-first
  and does not require an API key by default.

## Deploy & VPS (canonical)

- Deployment is owned by `../../aphrody-infra`. The VPS no longer runs Aphrody, NIE or IECode; only RG and Shenron are live.

## Agent home (`~/.aphrody`)

- La mémoire curatée et la politique agent-home sous `~/.aphrody/workspace/` sont des fichiers d'exécution locaux, absents de ce checkout.
- Doc repo: `aphrody/docs/dot-aphrody/README.md`

## Build rules (Linux)

- `export RUSTC_WRAPPER=` (sccache absent → build fail)
- `CARGO_CONFIG=~/aphrody/.cargo/config.linux-vps.toml`
- Release bins: `target/x86_64-unknown-linux-gnu/x86_64-unknown-linux-gnu/release/{aphrody,aphrody-mcp}`
- **One** `cargo build --release` at a time (LTO)
- Install: `scripts/release/deploy.sh` or `install -m 755` (not `cp` while binary running)
- [Sibling builds & versions](../memory/sibling-repo-build-and-versions.md) — `CARGO_TARGET_DIR` sends n2b/bxc builds into aphrody's target; bxc version is compile-baked; n2b 0.6.1 / bxc 0.6.2

## MCP

- Shared: `~/.config/aphrody/mcp.json` — `aphrody-mcp`, `bxc-mcp`; secrets in `~/aphrody/.env`, not JSON
- Claude uses aphrody plugin + same binaries

## Tooling / Bun

- [n2b --fix + agent stack Bun](../memory/n2b-fix-and-agent-stack-bun.md) — n2b only auto-applies the safe class (not fs/sleep); agent stack is Node-free
- VPS Bun is **1.4.0-canary.1** (manifests pin 1.3.14, ignore that)

## Cross-repo contracts (aphrody = hub)

- `aphrody/docs/rag-unified-pattern.md` — shared e5-small sidecar + RRF retrieval
- [bxc test pkgs: bxc-test + next-playwright](../memory/bxc-test-and-next-playwright.md) — Playwright-compat `@aphrody-code/bxc-test` + Next `instant()` port over native CDP (shipped, bxc `11a923d`); `Network.deleteCookies` fix

## A2A (Rust)

- `aphrody a2a serve|tick|invoke` — commit **b105cbd**+ ; tests `cargo test -p aphrody-a2a-coord --test http_e2e`
- Manifest: `~/aphrody/ai.json` · coord: `.coord/*.jsonl`

## Services — all **active + enabled** (verified 2026-06-04; may be stopped to save RAM)

| Unit | Port | Note |
| --- | --- | --- |
| `aphrody-site.service` | 8083 | Rust Axum sovereign origin (`aphrody.com`, Inacord, MCP, A2A, API Gateway) |
| `nie-site.service` | 8085 | Rust Axum VFS engine, wasm bundle, Inacord WebHost (`nie.aphrody.com`) |
| `bxc-site.service` | 8084 | Rust Axum stealth browser showcase (`bxc.aphrody.com`) |
| `nie-model-serve.service` | 8790 | GLB 3D live model assembler (`cdn.aphrody.com`) |
| `aphrody.service` | 8082 | Python `/opt/aphrody` — optional Python service |
| `bxc.service` | 9222 | CDP (execs bxc standalone — restart after a `bxc` rebuild) |
| `bxc-crawler.service` | — | 24/7 worker |

Re-enable: `sudo systemctl enable --now bxc.service bxc-crawler.service aphrody.service`
Stop to free RAM: `sudo systemctl disable --now bxc-crawler.service bxc.service aphrody.service`

## Credentials

- Diagnostic local : `aphrody doctor`. Smoke xAI/Grok/BXC sans chat par défaut :
  `bash ~/aphrody/scripts/test-xai-grok-bxc.sh`. Tout chat potentiellement
  facturable exige `RUN_PAID_XAI_SMOKE=1`.
- Never commit `~/aphrody/.env`, `~/.aphrody/x-session.json`, cookie jars
## Feedback (working style)

- [No questions, direct action](../memory/feedback-no-questions-direct-action.md) — execute, never ask for confirmation (user emphatic 2026-06-04)
- [No reflexive loops](../memory/feedback-no-reflexive-loops.md) — don't mechanically repeat bxc/workflow calls; think if the action is even needed (user said "infinite loop, pause et réfléchi" 2026-06-04)
