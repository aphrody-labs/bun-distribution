<!-- SPDX-License-Identifier: Apache-2.0 -->
# Shared AI, CLI and MCP owners — 2026-10-05

The [capability registry](../../packages/engine/core/src/tools/registry.ts) owns tool
schemas, validation, contexts, cancellation propagation and execution. The
[MCP adapter](../../packages/engine/core/src/mcp/server.ts) retains only JSON-RPC and
stdio framing; old exports remain compatible. HTTP/OpenAPI and the
[AI CLI](../../apps/yolo/cli/src/ai.ts) import the common owner directly. A bundle test
checks that HTTP no longer imports the MCP protocol implementation.

`yolo ai list` displays the same AI definitions as MCP/API.
`yolo ai call yolo_ai_infer '{"prompt":"question"}'` uses the existing
UnifiedInferenceEngine. Configure YOLO_INFERENCE_ENDPOINT; optional
YOLO_INFERENCE_MODEL and YOLO_INFERENCE_API_KEY configure the owner, never a
second credentials store. Caller-owned engines remain injectable. CLI signals
propagate cancellation; its context closes in finally. Existing vector retrieval
and dataset tools retain their names, schemas and owner semantics.

Validation: 135 core tests / 1544 assertions; 43 adapter/inference/MCP/HTTP tests /
198 assertions (overlapping suites, not additive coverage). An actual CLI child,
SDK, registry, MCP and loopback HTTP issue equal provider payloads and return
equal results except latency. TypeScript root and core, scoped strict oxlint and
oxfmt pass. Source tests do not prove model weights, new runtime artefacts,
installed CLI replacement, or activation of a persistent MCP server.

[Python adapters and remaining native work](../../py/docs/architecture/ai/OWNERS.md).
Aphrody's factory has an occupied heavy lock and an old source pin; no Rust
build or concurrent job interruption is claimed. The installed-help capture
reports yolo present and aphrody-python absent; the new source CLI is tested via
bin/yolo. Concurrent desktop/runtime changes in the dispatcher are preserved and
excluded from this delivery.
