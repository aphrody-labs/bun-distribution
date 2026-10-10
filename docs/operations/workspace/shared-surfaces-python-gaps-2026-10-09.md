<!-- SPDX-License-Identifier: Apache-2.0 -->
# Shared surfaces and Python consumer gaps

Owner request, 2026-10-09: complete gaps around the concurrent native site and
Python-to-Bun workers. This batch preserves their site, MCP router, app-server,
native Python host, PyO3 backend and source-transfer paths. It adds no service or
provider store and changes no host deployment.

## Shared CLI, MCP and A2A

`aphrody-command::ecosystem` keeps AI and OS ownership separate while resolving
both MCP surfaces to the canonical `aphrody-mcp server`. Existing enum values,
surface order and runtime-status response remain compatible. Finding the binary
is still file discovery, not a successful MCP handshake.

The A2A listener retains its bound TCP socket and uses its actual address before
building the router. This fixes discovery with port zero in the default,
profile-scoped and legacy-broker server modes. `APHRODY_A2A_PUBLIC_URL` keeps
priority for explicitly configured public routing. Unix-only mode has no TCP
address to discover; an externally usable TCP URL needs explicit configuration.

Validation, AgentCard metadata and middleware use one authentication snapshot.
Public discovery advertises the HTTP Bearer scheme when required; it never
receives the credential value. Profile stores, public discovery exceptions,
private-route authentication and task restart handling retain their contracts.

## Python runtime consumer

The Vu consumer resolves host targets through the existing runtime-SDK target
table and uses target-specific executable names and native PATH separators.
Artifact file names remain POSIX relative paths on every host. The quick/full
verifier rejects malformed manifests and reports filesystem failures as an
invalid artifact rather than throwing. Full verification resolves the artifact
root, including activation links, and confines manifest files and links to it.

Qualification uses native Windows and local fixtures; it does not establish an
installed Windows Vu distribution, complete uv/Ruff source parity or changed
Bun Python dispatch. Those belong to the ongoing Python/Bun work. The
[earlier Vu plan](../../plans/vu/PLAN.md) records the artifact contract; the
owner's 2026-10-09 directive moves its native implementation into the Bun fork.

## Gates and remaining scope

Native Windows gates passed, through `scripts/dev/windows-cargo.ps1` with the
shared Cargo lock and native sccache retained:

- `check -p aphrody-a2a-coord --locked` and `check -p aphrody-command --locked`.
- `test -p aphrody-a2a-coord --lib --locked`: 53 passed.
- `test -p aphrody-command --lib ecosystem::tests --locked`: 3 passed. The linker
  emitted its existing `LNK4098` CRT warning; this is not runtime qualification.
- `clippy -p aphrody-a2a-coord -p aphrody-command --all-targets --locked -- -D warnings`.
- `bun test test/vu.test.ts test/python-supervised.test.ts test/verify-python.test.ts`
  from `packages/engine/yolo`: 47 passed, 4 existing Unix/native-prerequisite
  skips, no failures. All 41 Vu tests ran on Windows.
- Scoped test/package TypeScript, oxlint, oxfmt, Rust formatting and diff checks.

The producer contract was inspected at Bun revision
`bfe7a8bba2a5e0f0b44db5c217d52c780192c686`,
`packages/bun-vu/scripts/{manifest,assemble}.ts`, on the configured VPS source
checkout. It specifies schema 1, `vu-runtime`, file/link records and full Git
revisions. Fixtures qualify consumer behavior; they do not qualify the producer
artifact. Independent source review found no remaining blocking defect.

The native site UI parity, all low-level OS capability adapters, durable Infra
discovery/activation, `.py` dispatch, Python/JS shared objects and buffers,
GPU/Cython/Jupyter and performance/installation matrices remain with their
capability owners. This gap batch does not close those broader plans.
