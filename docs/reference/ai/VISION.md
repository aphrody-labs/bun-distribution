<!-- SPDX-License-Identifier: Apache-2.0 -->
# Product direction

Build an open-source coding agent that completes real repository work through
Aphrody's native desktop and CLI. The same engine owns execution, durable
sessions, tools and model interaction. Existing AI capabilities feed useful
user actions through that engine and its persistent backend contracts.

The [current plan](../../plans/ai/PLAN.md) owns delivery decisions. The
[GUI contract](../../../m3/docs/reference/GUI.md) and
[UI design](../../../m3/docs/architecture/UI-DESIGN.md) own presentation and interaction.
An integrated product means a user can run, steer, stop, inspect and resume
real work with consistent state across those surfaces.

Open-weight inference must complete the acceptance tasks with declared model,
hardware and limits. Additional providers, RAG, OCR, voice and training extend
that product when their end-to-end flows work. Responsiveness is evaluated
against [measured latency budgets](../../plans/ai/PLAN.md#latency-budgets); zero latency is
not a deliverable.

The OSS core and optional bundles must satisfy their respective licensing
criteria in [release acceptance](../../plans/ai/PLAN.md#release-acceptance). In particular,
Drive and model licensing cannot be inferred from this repository's license.

The former Antigravity-rewrite vision is superseded. Its decisions and context
remain available in the
[historical vision at bb46076](https://github.com/aphrody-labs/aphrody/blob/bb46076ce7ab57ea3af96486dbefc66392ef3562/docs/VISION.md).
