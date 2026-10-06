<!-- SPDX-License-Identifier: Apache-2.0 -->
# Archived plan

This historical agent-home delivery plan is complete and no longer drives implementation.

The full plan, including its original evidence and decisions, is kept in the Git history of the former `aphrody` monorepo (`docs/plans/ai/plans/agent-home.md`).

Current work and acceptance evidence are tracked only in PLAN.md.

## Post-archive extensions (2026-10-06)

Delivered in `crates/ai/agent-home` and documented in
[AGENT-HOME.md](../../../reference/ai/AGENT-HOME.md#gestion-des-homes): external
template instantiation, profile fields (`avatar`, `agent_id`, `updated_at`,
`template_revision`), the Bun-computable `sha256-v1` revision, home merge and
two-way sync (dry run by default, verified backup before apply), the
configurable homes root (`APHRODY_HOMES_DIR`, `[agent_home] homes_dir`) and the
atomic home rename. Command line: `aphrody agent-home`.
