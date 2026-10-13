# Integrated Aphrody primitives

The root Cargo workspace now has 20 members: the 12 existing product crates
and eight Aphrody primitives extracted from source commit
`3187d795e84ff88da67f53f12be1add715ad73b2`.

The root owner reports Cargo metadata qualification passing with 559 packages
and 20 workspace members. This confirms dependency resolution and workspace
membership; compilation and tests of the eight new primitives have not been
executed during the reserved release window. No native gate was run by this
documentation audit.

## Integrated members

| Root member | Original source | Capability |
| --- | --- | --- |
| `crates/aphrody-a2a` | `crates/contracts/a2a` | A2A protocol types and coordination records |
| `crates/aphrody-agent-proto` | `crates/contracts/agent-proto` | Agent submission/event protocol and NDJSON |
| `crates/aphrody-app-protocol` | `crates/contracts/app-protocol` | JSON-RPC application protocol |
| `crates/aphrody-toolcall` | `crates/ai/toolcall` | Tool catalogue and asynchronous execution trait |
| `crates/aphrody-patch` | `crates/ai/patch` | Patch parsing and application |
| `crates/aphrody-toolcall-repair` | `crates/ai/toolcall-repair` | Tool-call JSON repair and validation |
| `crates/aphrody-translate-core` | `crates/ai/translate-core` | Comment extraction and rewriting |
| `crates/aphrody-http-error` | `crates/ai/http-error` | Shared JSON HTTP error envelope |

The repair crate's dev-dependency on `aphrody-patch` is the only internal edge
among these eight. Each member has `package.workspace = "../.."` and inherits
one product version, edition and MSRV. Its source remains a separate managed
Git submodule under the existing Infra forge owner.

## Metadata and license ownership

The root now defines `homepage = "https://aphrody.app"`, product keywords and
categories in `[workspace.package]`. Imported children preserve their own
explicit source metadata and forge repository identities. The root product
license remains MIT; all eight imported primitives explicitly retain
`Apache-2.0`, with attribution and notices preserved by their split owner.

The source lint policy is copied exactly into each child as local tables.
There is no new inherited `[workspace.lints]` requirement:

```toml
[lints.rust]
unsafe_op_in_unsafe_fn = "deny"
unused_must_use = "deny"
non_ascii_idents = "deny"

[lints.clippy]
todo = "deny"
unimplemented = "deny"
dbg_macro = "deny"
correctness = { level = "warn", priority = -1 }
perf = { level = "warn", priority = -1 }
```

## Shared dependency versions

The root owns the eight internal path dependencies at `=1.4.4` and these
new external pins, all with root `default-features = false`:

| Dependency | Root version |
| --- | --- |
| `async-trait` | `=0.1.92` |
| `axum` | `=0.8.9` |
| `pretty_assertions` | `=1.4.1` |
| `similar` | `=3.2.0` |
| `proptest` | `=1.12.0` |

The unused `schemars` dependency was removed from toolcall and the root.
Existing shared version owners for Serde, serde_json, thiserror, Base64,
Chrono, UUID, regex, Tokio and tempfile are reused.

## Feature sites observed in the imported manifests

| Use site | Explicit dependency features |
| --- | --- |
| A2A → Chrono | `default`, `serde` |
| A2A → Base64 | `default` |
| A2A → UUID | `default`, `v7`, `serde`; additionally `js` in its wasm target table |
| agent-proto → UUID | `default`, `v4`, `serde` in the existing non-browser target table |
| patch → Similar | `default` |
| repair / translate → regex | `default` |
| repair dev → Proptest | `default` |
| http-error → Axum | `json` |
| http-error dev → Tokio | `macros`, `rt` |

`features = ["default"]` selects the dependency's published default feature
at the child use site while its common root declaration keeps defaults
disabled. This preserves source Chrono clock/browser behavior, Base64 SIMD
and regex Unicode/engine behavior. `regex-syntax/default` is a transitive
implementation feature, not a feature to request from regex directly.

Serde and thiserror defaults are explicitly requested where the split
manifests preserve them; root Serde already enables `derive` and `std`.
Imported `pretty_assertions` dev sites explicitly request `default`, including
toolcall after the child owner corrected its manifest. The source defaults
are preserved; native test qualification remains pending.

Axum's JSON-only selection follows the actual error-envelope source
(`Json`, `StatusCode`, `IntoResponse`), which contains no server or listener.
This source inspection does not establish a performance or native-build gate.
The existing UUID wasm fallback and target-specific JS feature remain;
browser and WASI execution have not been qualified by Cargo metadata.

## Evidence and delivery boundary

Source manifests and symbols were read directly from the recorded Aphrody
commit. Installed vendor manifests were inspected for Chrono 0.4.45,
UUID 1.28.0, Base64 0.23.1 and Tokio 1.53.2. The primary crates.io version API
confirmed the exact audited new versions and their feature definitions,
as well as regex 1.13.1; schemars 1.2.3 was inspected before its unused
declaration was removed.

The current root and eight child manifests were reread after integration.
The root owner owns the shared lockfile, source pins and vendor refresh;
child owners own their precise manifests and Git histories. Metadata success
is distinct from compilation, tests, package publication and service activation.
