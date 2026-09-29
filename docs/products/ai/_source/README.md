<!-- SPDX-License-Identifier: Apache-2.0 -->
# aphrody-ai documentation

Start with the [product README](./README.md.a7d252bc425b), then the
[current execution plan](../../../plans/ai/_source/PLAN.md). `PLAN.md` is the only active product plan.
The native desktop's design and interaction contract belongs to
[aphrody-ui](../../../reference/ui/_source/GUI.md); its target method map does not
establish that a running backend implements every method.

## Current authorities

| Question | Authority |
| --- | --- |
| What ships next, and what proves it works? | [PLAN.md](../../../plans/ai/_source/PLAN.md#delivery-sequence), [release acceptance](../../../plans/ai/_source/PLAN.md#release-acceptance) |
| What exists, and what is still unverified? | [Current baseline](../../../plans/ai/_source/PLAN.md#current-baseline), [SOURCE_OF_TRUTH.md](../../../reference/ai/_source/SOURCE_OF_TRUTH.md) |
| How do the native UI, agent and workers connect? | [ARCHITECTURE.md](../../../architecture/ai/_source/ARCHITECTURE.md) |
| Which repository owns a capability? | [Organization and ownership](../../../plans/ai/_source/PLAN.md#organization-and-ownership), [generated ecosystem inventory](../../../reference/infra/_source/ecosystem/ECOSYSTEM.md) |
| What does each capability contribute to the product? | [Capability integration](../../../plans/ai/_source/PLAN.md#capability-integration) |
| What remains for Koharu, Aphrody and Shenron? | [Koharu convergence work packages](../../../plans/ai/_source/PLAN.md#koharu-aphrody-and-shenron-convergence) |
| What is the dated cross-repository Shenron pillar snapshot? | [ROADMAP-AGENT-PILLARS.md](../../../plans/ai/ROADMAP-AGENT-PILLARS.md) (historical metrics; verify against owners) |
| What does responsive mean? | [Latency budgets](../../../plans/ai/_source/PLAN.md#latency-budgets) |
| How are changes maintained and checked? | [DOCUMENTATION-PIPELINE.md](../../../reference/ai/_source/DOCUMENTATION-PIPELINE.md), [agent rules](../../../reference/ai/_source/AGENTS.md) |

## Working guides

- Setup and operation: [INSTALL.md](../../../guides/ai/_source/INSTALL.md), [CLI.md](../../../reference/ai/_source/CLI.md),
  [config.md](../../../reference/ai/config.md), [agent-console.md](../../../reference/ai/_source/agent-console.md),
  [TROUBLESHOOTING.md](../../../reference/ai/TROUBLESHOOTING.md), [PITFALLS.md](../../../reference/ai/PITFALLS.md).
- Engine and extensions: [agent-stack](./agent-stack/README.md),
  [MCP.md](../../../reference/ai/MCP.md), [MCP_SETUP.md](../../../guides/ai/MCP_SETUP.md),
  [AGENT-SKILLS-PLUGINS-SPEC.md](../../../reference/ai/_source/AGENT-SKILLS-PLUGINS-SPEC.md),
  [computer-use.md](../../../reference/ai/computer-use.md).
- Models and knowledge: [LOCAL-AI-MODELS.md](../../../reference/ai/_source/LOCAL-AI-MODELS.md),
  [RAG.md](../../../reference/ai/RAG.md), [training.md](../../../reference/ai/_source/training.md),
  [Google](./google/README.md), [Grok](./grok/README.md).
- Delivery and provenance: [GIT-GITHUB.md](../../../reference/ai/_source/GIT-GITHUB.md),
  [cargo](./cargo/README.md), [RELEASE-CHECKLIST.md](../../../operations/ai/_source/RELEASE-CHECKLIST.md),
  [THIRD_PARTY_CODEX.md](../../../reference/ai/_source/THIRD_PARTY_CODEX.md),
  [SECURITY-MODEL.md](../../../research/ai/_source/SECURITY-MODEL.md), [PRIVACY.md](../../../reference/ai/_source/PRIVACY.md).

Executable examples must be checked against current command help and source.
A guide or a generated crate description does not prove runtime readiness.

## Historical evidence

Dated audit snapshots removed from the working tree remain available at the
[2026-09-28 cleanup parent revision](https://github.com/aphrody-code/aphrody-ai/tree/51c8502949c420b9c8d4945fef0a63dcf2aaea33/docs/audits);
the research files still in this tree retain their original scope.
The [2026-09-26 protocol and desktop fact-check](../../../apis/ai/_source/research/agent-protocol-and-desktop-factcheck-2026-09-26.md)
and [Rust parity assessment](../../../research/ai/_source/research/codex-rust-parity-2026-09-26.md) are
historical observations, not current product certification.
The former [P0-P11 plan](../../../plans/ai/_source/plans/codex-oss.md) retains a provenance link and its
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
