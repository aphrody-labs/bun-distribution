<!-- SPDX-License-Identifier: Apache-2.0 -->
# Comparing Aphrody with the reference coding agent

The comparison scope is a coding-agent product: configuration, tool execution,
session durability, steering, cancellation, protocol behavior and usable
client flows. The [current baseline](../../plans/ai/PLAN.md#current-baseline) records the
implementation gaps; [release acceptance](../../plans/ai/PLAN.md#release-acceptance) defines
what closes them.

## Evidence and boundaries

| Question | Evidence required |
| --- | --- |
| Does a backend operation match the reference? | Same declared scenario against pinned revisions, with request, events, results and errors compared. |
| Does an OSS model complete useful work? | Real model and tools completing the task; model identity, hardware, constraints and failures recorded. |
| Does the desktop work end to end? | Native broker and UI driving a real backend, including stop, restart and session recovery. |
| Is it responsive? | [Latency measurements](../../plans/ai/PLAN.md#latency-budgets) separating UI/transport overhead from model and worker time. |
| Can the bundle be distributed as OSS? | License and dependency review of the actual artifact, including optional Drive components and weights. |

The pinned upstream checkout and any extracted code have separate provenance
in [THIRD_PARTY_CODEX.md](./THIRD_PARTY_CODEX.md). Protocol compatibility does not
establish equal model capability, security guarantees or desktop completeness.
Aphrody's RAG, training and additional providers need their own acceptance
scenarios; their presence does not close missing coding-agent behavior.

## Historical assessments

The [2026-09-26 Rust parity note](../../research/ai/research/codex-rust-parity-2026-09-26.md)
withdraws its earlier **4.5/10** score after correcting stale source claims.
No current numeric score is asserted; the active plan uses explicit release criteria.

The previous comparison with task runners and environment managers is
superseded and retained in
[Git history at bb46076](https://github.com/aphrody-labs/aphrody/blob/bb46076ce7ab57ea3af96486dbefc66392ef3562/docs/COMPARISON.md).
