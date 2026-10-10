<!-- SPDX-License-Identifier: Apache-2.0 -->
# aphrody-infra: agent rules

Owns hosts, topology, service/routes catalogues, remote operations and releases.
Follow [workspace rules](../workspace/AGENTS.md) and the user's global Codex policy.
**NHITL:** execute authorized work without confirmation prompts or interactive questions.
Configured YOLO/NHITL markers describe execution mode; they do not replace credentials.

- Resolve destinations and workloads from `config/` and `inventory/`.
- Inspect live state before changing a host. Keep operations idempotent, bounded
  and recoverable; preserve the runbook's backups, integrity checks and rollback.
- Keep secrets and raw runtime state outside Git and logs. Inventory is sanitized.
- Use [PLAN](../../plans/infra/PLAN.md) for open work and [README](../../products/infra/README.md) for commands.
  Historical deployment reports do not prove current service health.
- Documentation: check links/anchors and `git diff --check`. Implementation and
  deployment: run the relevant [validation gates](../../products/infra/README.md#validation) and live probes.
- Generate ecosystem catalogues with `scripts/tools/workspace/ecosystem.ts` when capability inventory
  changes; do not hand-edit or regenerate them for prose-only changes.
