<!-- SPDX-License-Identifier: Apache-2.0 -->
# Fresh agent home for a cloud session

A cloud container starts empty: no `~/.aphrody`, no credentials, no databases. The agent home is rebuilt from
the repository on each session and holds no secret. Status: the layout and commands below come from the sources
(`crates/ai/agent-home`, `aphrody oc-onboard --help`); the sequence was **not yet run in a cloud container**.

1. Toolchain: the SessionStart hook already runs `.claude/hooks/session-start.sh` and `scripts/dev/cloud-setup.sh`
   (Bun, Rust, uv, Graphify, build tools, local code graph). Log: `~/.local/state/aphrody/cloud-setup.log`.
2. Home root: `export APHRODY_HOME="$HOME/.aphrody"` (the single authority is `crates/ai/models` `paths`;
   per-domain homes live under `workspaces/{aphrody,dbfr,ie}`; in the cloud use only `aphrody`).
3. Binary: `aphrody` is not installed by default. Use the download server `install.sh` once `APHRODY_DOWNLOAD_BASE`
   is announced in [CLOUD-SYNC.md](CLOUD-SYNC.md), otherwise build the single crate through the factory
   (`bun scripts/build/rust/vps-cargo.ts run -- build --release -p aphrody`; a full release build exceeds 4 CPU).
4. Seed the home without prompts and without secrets:
   `aphrody oc-onboard --non-interactive --accept-risk --workspace "$APHRODY_HOME/workspaces/aphrody"`.
   It always writes `AGENTS.md` and `TOOLS.md` and the persona files `SOUL.md`, `IDENTITY.md`, `USER.md`,
   `HEARTBEAT.md`, `BOOT.md` (templates: `crates/ai/agent-home/templates`). Without the binary, copy those
   templates into `$APHRODY_HOME/workspaces/aphrody/` by hand; edit `USER.md` and `IDENTITY.md` for the owner.
5. Context: keep the repository's `AGENTS.md`, `MEMORY.md`, `PLAN.md` and
   [CONTEXT-HANDOFF.md](CONTEXT-HANDOFF.md) as the memory source; the cloud session adds its own notes to
   `MEMORY.md` and [CLOUD-SYNC.md](CLOUD-SYNC.md) and commits them.
6. Index: `graphify update .` (offline, no LLM) refreshes the code graph; the common index command
   (`aphrody index`) replaces it when the pipeline lands (plan: agent-home-pipeline). Refresh after each
   `git pull`, never commit `graphify-out/`.
7. Secrets: none are created. API keys come only from the claude.ai environment secrets, never from files in the
   repository; never copy `~/.aphrody/credentials`, `cookies` or databases from the owner machine.
