<!-- SPDX-License-Identifier: Apache-2.0 -->

# Google source ownership migration

The Google sources formerly at `crates/google/{antigravity,gemini-runtime,
gemini-web,google,model-antigravity}` in Aphrody now live in this independent
Cargo workspace. `aphrody-boq` is the shared codec at `../crates/boq`; it retains
its package identity, source bytes and seven tests with a separate provenance
receipt. Application stores, cookies, sessions and credential files are not
part of this source transfer.

The source checkpoint is Aphrody commit
`4b83ea7f6c2727d67c30d4942501e5b831e559dd`. Package version 1.4.4, editions,
Rust minimum version, licences, feature declarations and inherited lint levels
are preserved. Workspace registry dependencies use exact versions selected
from that checkpoint's Cargo.lock; original dependency features are retained.
No absolute workstation paths are part of the manifests.

## External contracts

`aphrody-proc`, `aphrody-config`, `aphrody-model-client`, `aphrody-toolcall` and
`aphrody-mcp-client` remain application contracts from the exact Aphrody Git
checkpoint. Their implementations are not copied into this workspace.
Obscura and its DOM crate resolve to the transferred sibling Web owner in the
Bun repository. The external API contracts are deliberate dependencies;
their availability through Cargo is a separate qualification gate.

`aphrody-mcp-client` transitively uses the old checkpoint's
`aphrody-web-service`. That service's dependency graph can bring the old Web
and Google graph into the resolution. A final consumer graph must unify those
packages to their new source owners before claiming one implementation per
capability. Applying source patches is a root integration task shared with the
Web workspace; a manifest-level move alone does not solve it.

Types from a Git dependency and a local path dependency are distinct even if
package names and versions match. In particular, the ModelClient/ToolExecutor
traits and config types must share a single resolved source identity with
Aphrody consumers. Do not bridge them using unsafe casts or advertise ABI
compatibility from identical names. Retiring the original Google sources
requires the consumer integration and its corresponding gates.

The JavaScript package retains its existing public exports and tests under
`packages/google`. Its former `workspace:*` application references require
the final Bun package integration. Existing subprocess adapters are preserved
as source, and are not native `bun:google` qualification. Neither the presence
of these packages nor Cargo metadata establishes OAuth access, Google service
availability, a working browser executable, JSC/V8 parity or host activation.

## Validation boundary

On 2026-10-11 full provider metadata resolves against eleven canonical application contracts in the sibling Aphrody checkout. Serialized all-target checks and strict Clippy pass for Antigravity, Gemini Web and Model Antigravity; 96 tests pass and one live-cookie test remains ignored. Boq separately passes seven tests and strict Clippy. Runtime-dependent Google and Gemini Runtime engine compilation remains pending.

Windows exact-target Credential Manager reads and native Cloud Code/Vertex helpers pass fixture tests in the changed Bun runtime. Models, generation, streaming, status and whoami execute in process; interactive PKCE login retains the original CLI owner. No real credentials or external service availability were tested.

Source ownership and qualified local sibling contracts do not establish portable release packaging, browser activation or JSC/V8 parity. Stores and sessions remain unchanged.
