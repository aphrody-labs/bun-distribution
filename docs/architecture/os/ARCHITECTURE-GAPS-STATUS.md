<!-- SPDX-License-Identifier: Apache-2.0 -->
# Architecture gap remediation status

This tracks the architecture gap audit provided on 2026-09-28. A green local build is not evidence
of an installed, secured, and monitored production service.

| Audit item | Current result | Evidence and remaining condition |
|---|---|---|
| 1. Agent identity | Configurable authenticated session scopes implemented | `aphrody-kernel --auth-file <absolute-path>` (or `APHRODY_KERNEL_AUTH_FILE`) loads principals with tool-prefix, registration and event-publish rights. Clients pass `APHRODY_OS_AUTH_TOKEN` during MCP initialization; missing or invalid tokens are rejected and tokens never appear in status APIs. Production rollout still must create a protected policy per host. |
| 2. Policy and sandbox | Tool dispatch policy enforced; sandbox execution open | `aphrody-kernel --exec-policy <absolute-path>` (or `APHRODY_KERNEL_EXEC_POLICY`) evaluates tool names via `aphrody-execpolicy` before kernel dispatch across RPC, A2A, and skills. Restricted sandbox requests fail closed. Production rollout still requires a host-local policy file with deny tests and argv/filesystem sandbox enforcement in process runtimes. |
| 3. RPC backpressure | Implemented locally | `transport.rs` limits inbound/outbound messages, queue depth and in-flight requests, bounds response waits, and cancels on disconnect. Bun receive buffering has the same line limit. |
| 4. Coordination | Stable compatibility store | [Compatibility contract](../../reference/os/COORDINATION-COMPATIBILITY.md) defines per-user storage, atomic writes and explicit migration. The frozen file tools do not claim to create durable `aphrody-jobs` records. |
| 5. Events | Durable local bridge implemented | `aphrody-kernel serve --audit-log <absolute-path>` bridges future `AgentBus` events into `aphrody-events` NDJSON. `system/audit_status` exposes whether it runs, lagged event count and write failures. The bridge never blocks tool dispatch. |
| 6. WinClean bindings | Catalog parity gate added | `scripts/generate-winclean-catalog.ts --check` checks all 166 names and Bun argument field/required parity, and regenerates exact catalog metadata. `scripts/audit/os/verify-winclean-integration.ts` also checks the migration ledger and probes a private hidden kernel. Full generated type and implementation regeneration remains open. |
| 7. Compatibility dispatcher | Partially decomposed | Coordination, Steam and notification implementations moved into domain modules. Other compatibility cases still route through `dispatch.rs`; the catalog and frozen names are unchanged. |
| 8. Re-export facade | Removed | `aphrody-os` had no consumers and added no composed API. Consumers use the owning crates. |
| 9. Backend mirror | Error and destination contract corrected | The mirror has an explicit optional destination, reports failed downloads, and is documented as a legacy asset helper. Live remote download and asset integrity have not been proved. |
| 10. Architecture docs | Corrected | Current architecture describes Rust-only WinClean and marks historical analysis as historical. |

## Observed local checks (2026-09-28, Windows)

`cargo fmt --check`, `cargo check --workspace --all-targets`,
`cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`,
`cargo deny check`, `bun install --frozen-lockfile`, `bun run typecheck`, `bun test`,
and `git diff --check` passed. `verify-winclean-integration.ps1` (now `scripts/audit/os/verify-winclean-integration.ts`) started a local kernel,
observed 166 catalog, Rust, ledger and kernel tools, and called `get_os_info` through IPC.
`cargo check --workspace` passed in
the AI, UI and Web consumers. These are source, build and local runtime checks only.

The GCS mock-server test failed twice while large sibling builds were active, then passed five
consecutive focused runs and the final workspace run. The isolated network flake remains a
test reliability risk.

A `--release` kernel build passed, and the binary was installed to
`%USERPROFILE%\.cargo\bin\aphrody-kernel.exe`. `--help` confirms `--exec-policy` support,
and live IPC probes answered `tools/list` and `get_os_info` with all 166 WinClean tools verified.

Historical check: the former third_party/bun and third_party/uv submodules were initialised at
`bf80d21c69c3` and `a9e231a7e377`, and
`scripts/verify-third-party-runtimes.ps1` (not in repo) passed. Commit `c3a99838` later removed
both source submodules. The current runtime uses the external system Bun/uv
installations; optional Bun docs remain outside the repository.

## Production exit conditions still open

- Create and protect an authenticated-principal policy for every production host, issue separate
  least-privilege tokens to its clients, and verify rejected/allowed IPC calls after rollout.
- Author and test host-local execution policies with deny rules for privileged operations,
  and provide an explicit sandbox backend for restricted process execution.
- Configure an absolute audit-log destination for every production kernel and monitor
  `system/audit_status` for lagged events or write failures.
- Complete WinClean binding generation and retire the remaining non-routing compatibility code.
- Coordinate a safe update of active aphrody-mcp sessions, then verify service identity,
  endpoint permissions, restart behavior and observability on each supported production target.
