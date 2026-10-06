<!-- SPDX-License-Identifier: Apache-2.0 -->
# aphrody-ai documentation

Start with the product README, then the
current execution plan. `PLAN.md` is the only active product plan.
The native desktop's design and interaction contract belongs to
aphrody-ui; its target method map does not
establish that a running backend implements every method.

## Current authorities

| Question | Authority |
| --- | --- |
| What ships next, and what proves it works? | PLAN.md, release acceptance |
| What exists, and what is still unverified? | Current baseline, SOURCE_OF_TRUTH.md |
| How do the native UI, agent and workers connect? | ARCHITECTURE.md |
| Which repository owns a capability? | Organization and ownership, [generated ecosystem inventory](../ecosystem/ECOSYSTEM.md) |
| What does each capability contribute to the product? | Capability integration |
| What remains for Koharu, Aphrody and Shenron? | Koharu convergence work packages |
| What is the dated cross-repository Shenron pillar snapshot? | ROADMAP-AGENT-PILLARS.md (historical metrics; verify against owners) |
| What does responsive mean? | Latency budgets |
| How are changes maintained and checked? | DOCUMENTATION-PIPELINE.md, agent rules |

## Working guides

- Setup and operation: INSTALL.md, [CLI.md](../reference/ai/_source/CLI.md),
  [config.md](../reference/ai/config.md), agent-console.md,
  [TROUBLESHOOTING.md](../reference/ai/TROUBLESHOOTING.md), [PITFALLS.md](../reference/ai/PITFALLS.md).
- Engine and extensions: [agent-stack](../products/ai/agent-stack/README.md),
  [MCP.md](../reference/ai/MCP.md), [MCP_SETUP.md](../guides/ai/MCP_SETUP.md),
  AGENT-SKILLS-PLUGINS-SPEC.md,
  [computer-use.md](../reference/ai/computer-use.md).
- Models and knowledge: LOCAL-AI-MODELS.md,
  [RAG.md](../reference/ai/RAG.md), training.md,
  [Google](../products/ai/google/README.md), [Grok](../products/ai/grok/README.md).
- Delivery and provenance: GIT-GITHUB.md,
  [cargo](../products/ai/cargo/README.md), RELEASE-CHECKLIST.md,
  THIRD_PARTY_CODEX.md,
  SECURITY-MODEL.md, PRIVACY.md.

Executable examples must be checked against current command help and source.
A guide or a generated crate description does not prove runtime readiness.

## Historical evidence

Dated audit snapshots removed from the working tree remain available at the
[2026-09-28 cleanup parent revision](https://github.com/aphrody-code/aphrody-ai/tree/51c8502949c420b9c8d4945fef0a63dcf2aaea33/docs/audits);
the research files still in this tree retain their original scope.
The [2026-09-26 protocol and desktop fact-check](../apis/ai/research/agent-protocol-and-desktop-factcheck-2026-09-26.md)
and [Rust parity assessment](../research/ai/research/codex-rust-parity-2026-09-26.md) are
historical observations, not current product certification.
The former [P0-P11 plan](../plans/ai/plans/codex-oss.md) retains a provenance link and its
referenced audit anchor. `ROADMAP.md`, `PLAN-POLYGLOT-2026.md`, `VISION.md`,
`COMPARISON.md` and `SAAS-FUTURE-PLAN.md` now route to the current plan or
explain its scope; they do not create parallel delivery tracks.

The dated [Koharu AI capability map](https://github.com/aphrody-code/aphrody-ai/blob/51c8502949c420b9c8d4945fef0a63dcf2aaea33/docs/audits/2026-09-27-koharu-ai-capability-map.md)
compares source-level manga OCR, translation, inpainting, model runtime and
agent capabilities with existing Aphrody AI owners. It is an inventory
snapshot, not a delivery plan or parity claim.

Older material can name repositories or paths that moved during the category
split. Resolve ownership through the current architecture and infra inventory
before using an old command, dependency or service name.

## Generated documentation

`SUMMARY.md`, `llms.txt` and `docs/_root/` mirrors are owned by
`aphrody-summary`; regenerate them rather than editing them by hand.
The generator includes historical Markdown in its context output, so each
historical page must state its scope. Read current authorities before dated
results. The ecosystem inventories are generated in `aphrody-infra` and are
source inventories, not service health reports.
