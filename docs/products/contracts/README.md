<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody Contracts

Neutral wire contracts: A2A, agent submissions/events, app-server, subsystem and
kernel client types, plus N2B schemas. No sibling repository dependency.

## Layout

- `crates/aphrody-a2a*`: types, protobuf, clients, server, gRPC and coordination.
- `crates/contracts/agent-proto`, `aphrody-app-protocol`: agent and desktop wire formats.
- `crates/contracts/subsystem`, `aphrody-kernel-client`: kernel contract and client.
- `schema/`: N2B project/report schemas; `ai.json`: reference agent manifest.
- `aphrody-a2a-slimrpc` is excluded until its upstream binding blocker is resolved.
  The A2A UI belongs to `aphrody-ui`.

## Use and validation

Consumers use the relative paths and versions declared in their manifests.
Workspace dependency changes affect those consumers. Use the pinned Rust toolchain
with `RUSTC_WRAPPER=`; [AGENTS.md](../../reference/contracts/AGENTS.md) owns gates, NHITL and wire discipline.
`just ci` runs repository checks; `just wasm` covers the declared wasm32 contracts.

| Reference | Purpose |
| --- | --- |
| [API](../../apis/contracts/API.md) | Naming, methods and known wire inconsistencies |
| [A2A](./a2a/README.md) | Bindings, native peers and coordination |
| [Publication ledger](../../plans/contracts/PLAN.md) | Prepared release scope |
| [Publication ladder](../../reference/ai/cargo/PUBLISH-LADDER.md) | Dependency order and commands |

Apache-2.0. Manifest publishability and historical dry runs do not prove upload.

## Automatisation transversale

`just boundaries` délègue la vérification Cargo à `aphrody-ops cargo-boundaries`.
