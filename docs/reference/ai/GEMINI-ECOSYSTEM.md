<!-- SPDX-License-Identifier: Apache-2.0 -->
# Google Gemini & Enterprise Agent Platform Ecosystem

Master map of official Google open-source repositories, SDKs, agent blueprints, and companion tools integrated or referenced by Aphrody.

## 1. Upstream Official Repositories

| Ecosystem / Scope | Official GitHub Repository | Description & Integration in Aphrody |
|---|---|---|
| **Gemini Developer Platform** | [`google-gemini/cookbook`](https://github.com/google-gemini/cookbook) | Official notebooks, tutorials, agent architectures, and multimodal guides for the Gemini API. Referenced in RAG/multi-turn workflows. |
| **Agent CLI & Workflows** | [`google-gemini/gemini-cli`](https://github.com/google-gemini/gemini-cli) | Open-source terminal agent integrating Gemini reasoning, file-system actions, and Model Context Protocol (MCP) servers. |
| **Antigravity CLI (Official)** | [`google-antigravity/antigravity-cli`](https://github.com/google-antigravity/antigravity-cli) | Flagship terminal orchestrator for Google Antigravity autonomous agents, native tools, and multi-file code editing (`agy`). |
| **Unified Gen AI SDK** | [`googleapis/python-genai`](https://github.com/googleapis/python-genai) | The official unified client library (`google-genai`) supporting both Gemini Developer API and Gemini Enterprise Agent Platform. Used in `py/aphrody` and `py/antigravity-sdk-python` (not in repo) (retired source path; retained as historical evidence). |
| **Cloud Enterprise Agents** | [`GoogleCloudPlatform/generative-ai`](https://github.com/GoogleCloudPlatform/generative-ai) | Enterprise implementation samples, agent evaluation harnesses, and notebooks for Google Cloud Generative AI. |
| **Platform Infrastructure** | [`GoogleCloudPlatform/vertex-ai-samples`](https://github.com/GoogleCloudPlatform/vertex-ai-samples) | Reference blueprints for agent deployment pipelines, Model Garden integrations, custom prediction routines, and MLOps. |
| **DeepMind Research Code** | [`google-deepmind`](https://github.com/google-deepmind) | Upstream research codebases, evaluation suites, and foundational model benchmark implementations (DeepSWE, Gemini 3.x series). |

## 2. Core Package Repositories

- **TypeScript / Node.js SDK:** [`googleapis/genai-js`](https://github.com/googleapis/genai-js) (`@google/genai` on npm) for server-side enterprise runtimes and Bun interop.
- **Gemma Open Models:** [`google-gemini/gemma-cookbook`](https://github.com/google-gemini/gemma-cookbook) for fine-tuning and running locally deployable companion models in `aphrody-models` / `aphrody-infer`.
- **Python Unified SDK:** `google-genai` on PyPI (`pyproject.toml` workspace dep).

## 3. Aphrody Native Mapping

| Upstream Resource | Aphrody Subsystem | Role |
|---|---|---|
| `google-genai` / `vertexai` | `py/packages/aphrody/src/aphrody/vertex.py` | Keyless access to Gemini 3.8 Flash via on-device Antigravity OAuth tokens. |
| `google-antigravity/antigravity-cli` | `crates/infra/aphrody-command/src/commands.rs` (`aphrody agy`) & `agy_loop.rs` | Auto-discovery and direct execution of the official `agy` binary with autonomous looping. |
| `google-antigravity` (SDK) | `py/antigravity-sdk-python/` (not in repo) (retired source path; retained as historical evidence) | Agent loop, tool context, thinking effort levels (`minimal`, `low`, `medium`, `high`). |
| `gemini-cli` / Cloud Code | `crates/infra/aphrody-command/src/agy_backend.rs` (not in repo) (retired source path; retained as historical evidence) | High-throughput in-process chat dispatch over Cloud Code daily endpoint. |
| MCP Servers | `crates/ai/mcp`, `crates/ai/mcp-client` | Native Rust MCP server and client. |
| Local Gemma Models | `crates/ai/models` & `~/.aphrody/models` | Local ONNX/GGUF model lifecycle management (pull, verify, evict). |
