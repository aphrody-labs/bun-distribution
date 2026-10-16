<!-- SPDX-License-Identifier: Apache-2.0 -->
# aphrody-ai source of truth

The current product objective, delivery order and acceptance criteria live in
[PLAN.md](../../plans/ai/PLAN.md). A design specifies intended behavior. Source establishes
what is implemented. A recorded run establishes what worked for its declared
build, configuration, target and workload. None substitutes for the others.

## Ownership

| Concern | Owner and authority |
| --- | --- |
| Agent loop, model clients, tools, sessions, RAG, OCR, voice, training and unified Aphrody/Dragon Ball plugin | `aphrody-ai`; [architecture](../../architecture/ai/ARCHITECTURE.md), unified plugin and implementation crates |
| Thread, turn and item wire types; extension negotiation | [aphrody-contracts](../../products/contracts/README.md) |
| Desktop presentation, M3, accessibility, broker and Drive integration | [aphrody-ui GUI contract](../../../m3/docs/reference/GUI.md), [UI design](../../../m3/docs/architecture/UI-DESIGN.md), [UI rules](../../../m3/docs/reference/UI-RULES.md) |
| Process supervision, sandbox, execution policy, secrets and system tools | [aphrody-os](../../products/os/README.md) |
| Terminal and TUI | [aphrody-shell](../../products/shell/README.md) |
| Browser, extraction, BXC and public web origin | [aphrody-web](../../products/web/README.md) |
| Native C/C++ ABI and compute foundation | [aphrody-native](../../products/native/README.md) |
| Bun compatibility and N2B | [aphrody-compat](../../products/compat/README.md) |
| Hosts, ports, routes, deployments, Git and release orchestration | [aphrody-infra](../../products/infra/README.md) |

The AI workspace consumes sibling crates through relative Cargo dependencies.
Siblings never add a reverse Cargo dependency on `aphrody-ai`. UI packages
consume the process contract, not AI implementation packages. The desktop's
persistent broker drives `aphrody app-server` over stdio JSON-RPC.

The generated [ecosystem catalog](../../ecosystem/ECOSYSTEM.md),
[command catalog](../../ecosystem/CLI.md) and
[MCP catalog](../../ecosystem/MCP-TOOLS.md) discover existing
owners. Their descriptions and counts are inventory evidence; runtime
availability comes from the running binary and its negotiated capabilities.

## AI service contracts

- Shared protocol types describe the wire vocabulary. The implemented
  [app-server dispatcher](../../../../crates/aphrody-app-server/src/lib.rs) and its
  handlers determine the supported subset.
- The desktop uses persistent stdio. The local HTTP app-server also has
  `/rpc` and an SSE `/events` transport; HTTP support is not evidence of a
  deployed, authenticated public service.
- UI target methods, type definitions and CLI command presence alone do not
  establish a working UI action. Each action needs its request, response,
  events, cancellation and error behavior verified together.
- `aphrody-mcp` serves AI tool and HTTP surfaces. Feature flags, configured
  backends and credentials affect availability. Public exposure and routing
  remain decisions of `aphrody-infra` and the owning web service.
- Explicit full-access execution can qualify the first coding slice. It
  must be presented as full access. Restricted modes remain unavailable
  until the backend enforces and verifies them; never infer confinement
  from a policy enum, GUI selection or process-group creation.

Existing names such as `bxc` and `n2b` identify owners and compatibility
surfaces. Rename them only with a versioned consumer migration.

## State and storage

`APHRODY_HOME` selects the runtime state root, normally `~/.aphrody`.
Configuration and active profiles determine the effective paths for sessions,
models, runtimes, cache, memory and RAG stores. Resolve them through the
owning runtime; a remembered default path is not proof of the active store.
Secrets stay in their native store or backend and never enter UI state,
documentation, ingestion output or evidence artifacts.

## Required proof

Use these claim boundaries in plans, release notes and reports:

| Claim | Required evidence |
| --- | --- |
| Source exists | File and revision, including feature conditions and known gaps |
| Contract is implemented | Handler behavior and focused contract checks, including refusal paths |
| Local scenario works | Real binary/model or worker run, inputs, configuration, output and exit status |
| UI scenario works | Installed or packaged UI driving the real backend through the complete user flow |
| Performance meets budget | Declared hardware, build, warm/cold state, workload and latency distribution |
| A release is available | Artifact identity, supported-target checks, install/upgrade proof and licensing review |
| A service is deployed | Infra-owned target, deployment revision and live probe |

`FAIT` applies only to the scope actually verified. `INCOMPLET` identifies the
missing proof or integration; `NON_FAIT` identifies the blocker. Do not promote
an old benchmark, test total, capability flag or numeric comparison into a
current whole-product claim.

For documentation-only changes, regenerate the documentation, check links and
review the diff as described in [DOCUMENTATION-PIPELINE.md](./DOCUMENTATION-PIPELINE.md).
Behavior changes require the affected checks and repository gates in the
[README](../../products/ai/README.md#build-and-test). Passing documentation gates proves
neither runtime correctness nor a shipped product.

The OSS core release and a release containing Drive have separate licensing
acceptance. Review the actual Drive/upstream licenses, including FSL material,
before claiming that the complete bundle is open source; the core's license
does not relicense sibling components or model weights.

## Canonical documents

- [PLAN.md](../../plans/ai/PLAN.md) — the sole current execution plan and acceptance criteria.
- [ARCHITECTURE.md](../../architecture/ai/ARCHITECTURE.md) — system shape and integration boundaries.
- [PITFALLS.md](./PITFALLS.md) — observed implementation traps.
- [DOCUMENTATION-PIPELINE.md](./DOCUMENTATION-PIPELINE.md) — authority and maintenance.
- [AGENTS.md](./AGENTS.md) — contributor execution and repository rules.
