<!-- SPDX-License-Identifier: Apache-2.0 -->

# aphrody-a2a-pb

Generated protobuf bindings and conversion utilities for the A2A v1
protocol, used throughout the Aphrody agent-to-agent stack.

## What is `aphrody-a2a-pb`?

`aphrody-a2a-pb` provides the prost-generated message types and tonic gRPC
stubs for the A2A v1 protocol (`proto/a2a.proto`, package `lf.a2a.v1`). It is
imported in Rust as `aphrody_a2a_pb`. The gRPC stubs are pre-generated in
`src/gen/` and ship in the crate; the ProtoJSON types are generated into
`OUT_DIR` by `build.rs` with a vendored `protoc` (`protoc-bin-vendored`), so a
build needs neither a system `protoc` nor network access.

Two module surfaces are exposed:

- `proto` — prost message structs plus tonic `A2aServiceClient` /
  `A2aServiceServer`. Not available on `wasm32` because tonic transport
  transitively requires `mio`/`tokio::net`.
- `protojson` / `protojson_conv` — pure prost message structs with pbjson
  serde derives. Available on all targets, including `wasm32`. WASM consumers
  must use `protojson_conv` for serialisation.

## Install

```toml
[dependencies]
aphrody-a2a-pb = "0.1"
```

## Generated types

All types live under the `aphrody_a2a_pb::proto` module on native targets and
under `aphrody_a2a_pb::protojson` on all targets (including wasm32). The five
most important public types are:

| Type | Proto message | Role |
|---|---|---|
| `Task` | `lf.a2a.v1.Task` | Core unit of agent work; carries `status`, `artifacts`, and `history`. |
| `Message` | `lf.a2a.v1.Message` | Single communication unit; holds `role`, `parts`, and optional metadata. |
| `Part` | `lf.a2a.v1.Part` | Content fragment inside a `Message`; oneof `text`, `raw`, `url`, or `data`. |
| `Artifact` | `lf.a2a.v1.Artifact` | Task output container; one or more `Part` values plus an artifact ID. |
| `TaskStatus` | `lf.a2a.v1.TaskStatus` | Current state snapshot for a `Task`; wraps `TaskState` enum and timestamp. |

The tonic service traits `A2aServiceClient<T>` and `A2aServiceServer<T>` are
generated in `proto::a2a_service_client` and `proto::a2a_service_server`.

The `pbconv` module exposes `to_proto_struct`, `from_proto_struct`,
`json_value_to_proto_value`, and `proto_value_to_json_value` for lossless
round-trips between `serde_json::Value` maps and `prost_types::Struct`.

The `protojson_conv` module exposes the `ProtoJsonPayload` trait along with
`to_value`, `from_value`, and `from_str` helpers for serialising native `aphrody-a2a`
crate types via the pbjson ProtoJSON wire format.

## Regeneration

To refresh the committed `src/gen/` stubs after a `.proto` change:

```bash
A2A_PB_REGEN=1 cargo build -p aphrody-a2a-pb --locked
```

Without `A2A_PB_REGEN`, `build.rs` writes only to `OUT_DIR`, as crates.io
requires of build scripts. Never set it when packaging or publishing.

## Cross-platform

| Target | `proto` + tonic | `protojson` + `protojson_conv` |
|---|---|---|
| Linux (x86_64-unknown-linux-gnu) | Supported | Supported |
| Windows (x86_64-pc-windows-msvc) | Supported | Supported |
| WASM (wasm32-unknown-unknown) | Not available | Supported |

## License

Apache-2.0.

## Related crates

- `aphrody-a2a` — canonical A2A v1 protocol types and core definitions.
- `aphrody-a2a-client`, `aphrody-a2a-server`, `aphrody-a2a-grpc` — the transport
  layers built on these bindings.
