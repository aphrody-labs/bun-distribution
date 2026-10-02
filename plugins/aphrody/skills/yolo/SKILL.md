---
name: yolo
description: "Autonomous execution on any repo or host: discover plan, gates and owners, then implement, validate, commit, record. Modes: single, grind, perfect loop, plan. Triggers: yolo, grind, start, lance, continue, autonome, enchaîne."
metadata:
  version: "4.0.0"
  author: "aphrody-code"
  license: "Apache-2.0"
---

# YOLO — autonomous execution

The contract is `~/.codex/YOLO-NHITL.md` (`APHRODY_YOLO`, `APHRODY_NHITL`,
`APHRODY_AGENT_AUTHENTICATED`, `APHRODY_AUTO_APPROVE`). YOLO removes human
gating, never technical gates: nothing is "done" until the repository's own
gates pass with real output.

## 1. Discover before touching anything

1. **Owners and rules**: the repository's `CLAUDE.md` / `AGENTS.md` / `README.md`
   override generic habits. In the Aphrody monorepo, Rust and Bun owners live
   in `crates/` and `packages/`; `packages/infra/workspace` orchestrates this
   checkout and the other active roots.
2. **Plan**: `PLAN.md`, `docs/plans/`, `UNIFIED-PLAN.md`, `ROADMAP.md`,
   `TODO.md`; open items are `- [ ]`, `⏳`, `TODO:`. No plan and no open item →
   the job is running the gates and fixing what is red.
3. **Gates**: take them from the repo (`justfile`, `package.json` scripts,
   `.github/workflows/`, docs "Validation" section). In this Aphrody workspace,
   workers do not run Cargo; the integrating agent executes one Cargo gate at a
   time with `scripts/build/rust/cargo-serial.sh <cargo args...>`. Do not
   background or parallelize Cargo. Typical gates are `check --workspace
   --all-targets`, `clippy … -D warnings`, `test`/`nextest`, `deny check`, and
   `git diff --check`.
   A missing gate config (e.g. no `deny.toml`, so every license is rejected)
   is a defect to fix, not a gate to skip.
4. **Working tree**: `git status --short`. Files you did not change belong to
   someone else (another agent, the user). Never stage, revert or "clean" them;
   stage only your paths. Re-check before each commit — concurrent agents
   create files mid-session.
5. **Host**: `hostname` and the repo path before concluding anything about
   production. The active release, not the Git commit, says what is live.

## 2. Modes

| Mode | Trigger | Behaviour |
| --- | --- | --- |
| single | `/yolo <item>` | One item end-to-end: implement → gates → commit → ledger. |
| grind | `/yolo-grind` | Per tick, up to 4 parallel agents, each owning one item and a distinct file family; orchestrator runs gates and makes one batched commit. |
| perfect | `/yolo-perfect-grind` | Grind ticks until the oracle passes (§4); `ScheduleWakeup` between ticks when running under `/loop`. |
| plan | `/start`, "exécute le plan" | Follow the plan top-down, generate the next items into the plan when it runs dry. |

Audits and broad sweeps: dispatch read-only `Explore` agents in parallel, one
dimension each (hosts, toolchains, service plane, cross-repo invariants), then
synthesize. Their dumps stay out of the main context.

## 3. Decide vs ask

Decide and record (commit body + plan ledger) every reversible choice: naming,
architecture between two sane options, next item, scope of a refactor.

Ask once — concise options, recommended first — only when:

- production state is ambiguous (outage vs intentional retirement look the
  same from outside; read the journal first, then ask);
- the action is irreversible on shared/production state and the user has not
  explicitly asked for it (force-push, publishing, deleting data without a
  verified copy, spending money).

An explicit user instruction ("purge node", "stop everything") is the
authorization; still take the safe path (§5).

## 4. Perfection oracle (perfect mode)

All detected gates green, 0 unblocked plan items, validator/consistency
checks clean. Stop when it passes, when 3 consecutive ticks ship 0 FAIT, or
when the only remaining items are operator-gated (document them as NON_FAIT).

## 5. Host and infrastructure playbook

Learned on the aphrody-infra rebuild; apply to any server work.

1. **Observe first**: read-only probes (`systemctl --failed`, `journalctl -u`,
   `ss -ltn`, `df`, `ps`) before any mutation. Distinguish a controlled stop
   ("Deactivated successfully" sequence) from a crash.
2. **Inventory → backup → act → verify → record**: list exactly what will be
   removed, archive it (config tarball, `pg_dump`, cold copy of a stopped
   PostgreSQL, SQLite files) with SHA-256 sums, act, re-probe, then update the
   inventory file and the plan ledger.
3. **Never delete before verification**: offload with `rclone`/`rsync`, run
   `rclone check` / `sha256sum -c`, and only then delete. Check running
   processes (`ps`, `lsof`) so no live service reads what you remove.
4. **Reclaim through an allowlist** kept in config (plan by default, `--apply`
   to delete), never through ad-hoc `rm`. Caches, build output and trash go
   first; databases, assets and git-ignored runtime data never without a copy.
5. **Package purges**: simulate (`apt-get -s`), purge the whole family in one
   transaction, then check `apt-get check`. `--fix-broken` may install a
   substitute (NodeSource `nsolid` replaced `nodejs`); remove the third-party
   source too. Units: disable *and* delete, or they return on reboot.
6. **Transport pitfalls**: Git Bash rewrites `/mnt/...` paths passed to
   `wsl.exe` (use `MSYS_NO_PATHCONV=1` or a script file); `dash` exits on
   `command -v -a`; non-interactive ssh does not load profile `PATH`; a Windows
   `~/.cargo/config.toml` seen through `/mnt/c` can force `sccache`.
7. **Single control plane**: express host changes as declarative config plus a
   CLI in the infra repository (`validate`, `reclaim`, `dev-env`, `deploy`),
   not as one-off shell sessions.

### nie (former `nie-autonome` skill)

In `nie`, pick the target by the number, never by intuition: `nie-forge candidates --no-reloc`,
the `blocker` lines of `lift`, the RE coverage delta (see `nie-re-workflow`). On a plateau,
enrich the diagnosis (`blocking_detail`, `orig=` vs `nie-asm=`) instead of guessing. The forge is
the judge: `build` fails when `sha256(dist/nie.exe)` differs from the reference; never "fix"
that test and never count `semantic` units as produced bytes. Nothing enters `forge/asm/*.s`
that does not re-encode exactly. Python always through `uv run`.

## 6. Honest delivery

Every report and batch commit classifies deliverables:

- **FAIT** — shipped with a verifiable artefact (command output, counts).
- **INCOMPLET** — partial; name what is missing.
- **NON_FAIT** — blocked; name the blocker (usually an operator decision).

Report real numbers (tests passed/failed, GiB freed, gate output). Never claim
green without running the gate. Commits: Conventional Commits, SPDX headers
where the repo uses them, no secrets, no force-push to default branches.

## References

- `references/launch-playbook.md` — growth/launch playbook used by plan mode
  when the plan targets adoption.
