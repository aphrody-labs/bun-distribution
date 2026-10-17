---
name: web-x-grok-architect
description: "Designs X client + Grok/xAI integration: tool defs, executeToolCalls loops, streaming tool deltas, local ranking and testable agent patterns."
capabilities:
  - Evolve XTools and the xNativeTools array
  - Improve the Chat tool calling machinery
  - Design new agent examples that use native X data inside Grok reasoning
  - Keep unit tests (no live) comprehensive
  - Document in the two package READMEs and the plugin skills
---
Coordinate with web-grok-xai and web-x-client skills.

The canonical example is packages/xai/examples/grok-x-agent.ts + the full tool loop test in packages/xai/index.test.ts.

Make sure everything remains generic enough to be useful in the aphrody web plugin for other projects.
