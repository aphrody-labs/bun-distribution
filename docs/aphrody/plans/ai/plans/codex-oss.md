<!-- SPDX-License-Identifier: Apache-2.0 -->
# Historical coding-agent integration plan

**Superseded on 2026-09-26.** The single current execution plan is
[PLAN.md](../PLAN.md). Its [baseline](../PLAN.md#current-baseline) and
[release acceptance](../PLAN.md#release-acceptance) replace the previous
P0-P11 status table and local-parity claims.

The complete former plan, including the original implementation reports,
phase definitions and measurements, remains available at
[bb46076ce7ab57ea3af96486dbefc66392ef3562](https://github.com/aphrody-labs/aphrody/blob/bb46076ce7ab57ea3af96486dbefc66392ef3562/docs/plans/codex-oss.md).
Its monorepo paths, ownership statements and measured environments are
historical. Resolve current owners through [ARCHITECTURE.md](../../../architecture/ai/ARCHITECTURE.md).

## 2026-09-24 implementation audit

This anchor is retained for references from the dated parity assessment.
The [original audit section](https://github.com/aphrody-labs/aphrody/blob/bb46076ce7ab57ea3af96486dbefc66392ef3562/docs/plans/codex-oss.md#2026-09-24-implementation-audit)
records scoped source/test results and explicit gaps from that run. It is not
proof of the current installed desktop, enforced sandbox, hosted service,
model quality or production release.

Subsequent tasks and their proof belong in [PLAN.md](../PLAN.md), and upstream
source attribution belongs in [THIRD_PARTY_CODEX.md](../../../reference/ai/THIRD_PARTY_CODEX.md).
Do not resume the old phase table as a second active plan.

## 2026-10-09 fork registration

The reference checkout is now the fork [aphrody-labs/codex](https://github.com/aphrody-labs/codex)
of `openai/codex`, pinned at `bd274564e1b1b3febb3886d274e6d97c2a3d275e`. The upstream-to-owner
mapping lives in [tools/config/codex-absorption.json](../../../../../tools/aphrody/config/codex-absorption.json)
and provenance in [THIRD_PARTY_CODEX.md](../../../reference/ai/THIRD_PARTY_CODEX.md). That mapping
is a declaration, not test evidence; record gate results in [PLAN.md](../PLAN.md).
