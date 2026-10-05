<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody AI and Codex Rust: corrected source comparison — 2026-09-26

## Scope and correction

**The previous 4.5/10 score is withdrawn.** Its evidence mixed dated plans
with current source and incorrectly treated `--image`, `--output-schema`
and HTTP SSE as missing. The arbitrary partial-credit rubric did not measure
end-to-end product quality or establish an objective completion percentage.
No replacement numeric score is asserted here.

This note compares source responsibilities against the pinned Rust reference
`openai/codex` commit `a6bd19261c30ce0a0225fe90e646822d29916f11`.
It records observations and historical tool output. The sole active plan is
[PLAN.md](../../../plans/ai/PLAN.md); its [current baseline](../../../plans/ai/PLAN.md#current-baseline)
and [release acceptance](../../../plans/ai/PLAN.md#release-acceptance) define current work.
This document does not certify a release, installed UI, model quality or
security policy.

## Source comparison

| Domain | Established implementation and remaining proof |
| --- | --- |
| CLI | `exec`, JSON events, resume/fork, configuration, `--image` and `--output-schema` exist. Supported flags, results and errors still need the declared acceptance scenarios; old missing-flag claims are superseded. |
| Configuration and project instructions | `aphrody-config` and `aphrody-project-doc` own configuration and AGENTS.md loading. Matching names and structures do not prove all precedence, discovery and error semantics against the pinned reference. |
| Engine and orchestration | `aphrody-engine` streams model events, executes tools, reinjects results and records rollouts. Completion, steering, interruption, failure and persistence need end-to-end proof through the selected client. |
| Models and providers | Managed local llama-server and multiple provider adapters exist. Each selected backend needs real task and transport evidence; provider breadth does not imply equal coding quality. |
| Tools and MCP | `aphrody-agent-tools`, `aphrody-mcp-client` and related owners provide tool execution and integrations. Schemas, permissions, cancellation, failures and results must be checked for the delivered subset. |
| Sessions and history | Resume, fork, rollouts and thread lifecycle operations exist. Restart, interrupted writes and client reconciliation require durable-state evidence. |
| App-server | A subset of the shared app-server contract is implemented. Stdio and HTTP SSE `/events` exist; current queue draining uses 10 ms stdio and 50 ms SSE timers. These intervals are implementation observations, not measured end-to-end latency. |
| Native UI and terminal | UI and shell belong to sibling owners. The [GUI method map](../../../../m3/docs/reference/GUI.md) describes target integration; much of that map still needs implementation and installed-user-flow proof. |
| Targets and distribution | Historical focused checks and model runs establish their recorded scope only. Supported artifacts need the current install, runtime, licensing and platform acceptance gates. |
| Execution policy | Explicit full-access execution can qualify the first coding slice. Restricted sandbox modes and approvals require backend enforcement and denial/error tests before exposure. A policy type or process group is insufficient. |

The full-access slice can be delivered while restricted-mode work continues.
It must remain explicitly full access. Source presence, successful compilation
and a GUI capability label cannot establish sandbox confinement.

Local RAG, embeddings, OCR, voice, vision, training and ecosystem integrations
are separate product capabilities. Their working paths and limitations belong
in the [capability integration plan](../../../plans/ai/PLAN.md#capability-integration).
Each must reach a useful UI action through its existing owner; capability
count does not substitute for a functioning coding-agent workflow.

## Upstream source and extraction provenance

`thirdparty/codex` is the shallow Git submodule pinned to
`a6bd19261c30ce0a0225fe90e646822d29916f11` for this comparison.
Previously adapted or copied code has older provenance at
`78245b47af2a7aafcabe025828ceecca69db4df1`; the newer audit checkout does
not change that origin. See [THIRD_PARTY_CODEX.md](../../../reference/ai/THIRD_PARTY_CODEX.md)
for the extraction and attribution record.

Pinned reference sources:

- [Rust workspace](https://github.com/openai/codex/tree/a6bd19261c30ce0a0225fe90e646822d29916f11/codex-rs).
- [App-server documentation](https://github.com/openai/codex/blob/a6bd19261c30ce0a0225fe90e646822d29916f11/codex-rs/app-server/README.md).
- [Tool orchestration](https://github.com/openai/codex/blob/a6bd19261c30ce0a0225fe90e646822d29916f11/codex-rs/core/src/tools/orchestrator.rs).
- [Sandbox orchestration](https://github.com/openai/codex/blob/a6bd19261c30ce0a0225fe90e646822d29916f11/codex-rs/core/src/tools/sandboxing.rs).

## Historical Aphrody-native discovery record

The following outputs were recorded during the original 2026-09-26 audit.
They are retained as provenance and were not rerun for this correction.

- `aphrody git repo openai/codex --pretty` identified the repository;
  `aphrody git api '/repos/openai/codex/commits/main'` returned the pinned
  `a6bd192...` revision, timestamped 2026-09-26 17:31:48 UTC.
  `aphrody git search 'openai/codex' --limit 3` returned it first.
- Remote `aphrody ingest` produced one app-server README digest, estimated
  at 8.2k tokens, and two core README files, estimated at 1.6k tokens.
  The include filter did not retrieve the requested Rust implementation;
  `aphrody git api` supplied the exact pinned files instead.
- Local ingestion of `crates/ai/app-server` covered six files, estimated
  at 39.7k tokens. It supported navigation, not runtime verification.
- `aphrody infra status --json` reported its configured layer nominal;
  `aphrody web status --json` reported an active engine. Neither established
  coding-agent parity. `aphrody web fetch` returned a start message without
  usable page content; ACP community results from `aphrody docs search` did
  not establish Codex or Aphrody behavior.
- Local ingestion of `thirdparty/codex` wrote the ignored runtime digests
  `var/codex-sandboxing.digest.md` (not in repo) (one file, 5.4k estimated tokens) and
  `var/codex-orchestrator.digest.md` (not in repo) (one file, 6.6k estimated tokens).
  Digests are analysis artifacts, not extracted source or transferred code.
- The source review covered the AI engine, runtime, app-server, MCP client,
  rollout and sibling protocol owners. The OS review observed discarded
  setup results in `aphrody-sandbox/src/runner.rs` and a Unix hook that ignored
  `SandboxPolicy` while setting a process group. No runtime denial test was
  run in that audit. Enforcement and its tests belong to the OS owner.
- The local CLI reported an AI router ready and 29 installed model files,
  but `aphrody chat --local` failed to connect to its configured inference
  endpoint (`127.0.0.1:8080` in that attempt). The focused
  `aphrody docs search --github --limit 1` sandbox query returned no
  repositories. No model-generated answer or successful inference was
  inferred from these outputs.

The [historical 2026-09-24 implementation audit](../../../plans/ai/plans/codex-oss.md#2026-09-24-implementation-audit)
retains its original scope. Future completion claims require the current
[release acceptance evidence](../../../plans/ai/PLAN.md#release-acceptance), with failures
and unavailable capabilities reported explicitly.
