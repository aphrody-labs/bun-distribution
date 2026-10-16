<!-- SPDX-License-Identifier: Apache-2.0 -->
# Architecture gap audit

Audit date: 2026-09-28
Scope: Rust crates, kernel runtime wiring, Bun packages, and architecture documentation in
`aphrody-os`. Findings below are based on checked-in source and dependency metadata, not a build,
live service probe, or sibling-repository audit.

## Findings

### 1. Agent identity and scope are documented but not enforced by the kernel

**Priority: P1 if multiple agents or authority scopes share the kernel; otherwise P2.**

[`YOLO-AUTHORITY.md`](../../reference/os/YOLO-AUTHORITY.md) requires `APHRODY_AGENT_AUTHENTICATED` and an explicit
`APHRODY_AUTHORITY_SCOPE`. In the implementation, `tools/call` dispatches directly to the named
tool, while `system/register_subsystem` accepts the caller's advertised name and catalog; neither
path checks an identity, token, peer credentials, or scope. The Unix socket is created with mode
0600, but that does not distinguish processes or agents running as the same user. As a result, the
documented identity and scope model currently has no kernel enforcement point.

Evidence: [`rpc.rs`](../../../../crates/aphrody-kernel/src/rpc.rs), `tools/call` and
`system/register_subsystem`; [`transport.rs`](../../../../crates/aphrody-kernel/src/transport.rs), local
endpoint setup.

**Direction:** define the intended trust boundary (all processes of one OS user, or individually
authenticated agents). If scopes are part of the security contract, carry authenticated identity
and scope into each session and authorize tool calls and subsystem registration there.

### 2. Policy and sandbox crates are not in the kernel call path

**Priority: P1 for a policy-enforced control plane; P2 if they are intentionally client-side only.**

`aphrody-execpolicy` is declared by the kernel but has no source-level call site there;
`aphrody-guard` has no kernel consumer (the unused `aphrody-sandbox` crate was removed). The kernel's binary registers
subsystems and its RPC handler calls them directly, with no policy or sandbox check in between.
This leaves a gap between the repository's ownership statement (kernel owns execution policy and
sandboxing) and runtime enforcement, especially for remote subsystem calls and admin operations.

Evidence: [`aphrody-kernel/Cargo.toml`](../../../../crates/aphrody-kernel/Cargo.toml),
`main.rs` (`builtin_kernel`), and
[`rpc.rs`](../../../../crates/aphrody-kernel/src/rpc.rs) (`tools/call`).

**Direction:** make the policy boundary explicit and enforce it at kernel dispatch or document
which clients own enforcement. Avoid presenting re-exported policy crates as kernel enforcement.

### 3. RPC request handling has no backpressure or per-session concurrency limit

**Priority: P1 for a long-lived privileged service.**

The transport checks for lines over 64 MiB, but only after `next_line()` has assembled the complete
line in memory. It also uses an unbounded outbound queue and spawns a Tokio task for every request.
A slow peer or a burst of large/concurrent requests can therefore accumulate input buffers, queued
messages, task state, and parsed JSON without a configured per-connection bound. The Bun client
also appends received chunks to an unbounded string buffer until it sees a newline. This is a
resource-exhaustion risk within the local trust boundary and makes overload behavior hard to
control.

Evidence: [`transport.rs`](../../../../crates/aphrody-kernel/src/transport.rs) (`MAX_LINE`, unbounded queue,
request task spawn); [`packages/os/kernel-client/src/index.ts`](../../../packages/os/kernel-client/src/index.ts) (`#receive`).

**Direction:** add bounded queues, request/concurrency quotas, output and input limits appropriate
to binary/image payloads, and cancellation or deadlines for work that outlives its peer.

### 4. Coordination tools still use an ad hoc working-directory file store

**Priority: P2.**

The convergence plan assigns coordination state to durable `aphrody-jobs` plus `aphrody-a2a`, but
the live `coord_*` handlers write `CURRENT_TASK.md`, `STATUS_*.txt`, and read a `STOP` marker under
`APHRODY_COORD_ROOT` or `<current working directory>/.coord`. The workspace dependency graph shows
no consumer of `aphrody-jobs`. Since the default root follows the kernel process working directory,
the same tool can address different coordination state depending on how the kernel was launched;
these files also bypass the planned job state machine and recovery model.

Evidence: [`WINCLEAN-RUST-CONVERGENCE.md`](../../reference/os/WINCLEAN-RUST-CONVERGENCE.md), coordination ownership;
[`dispatch.rs`](../../../crates/os/kernel/comps/winclean/src/dispatch.rs), `coord_root` and `coord_*` handlers;
[`aphrody-jobs`](../../../../crates/aphrody-jobs/src/lib.rs), currently not consumed by another workspace
crate.

**Direction:** either implement the planned adapter to the durable job/A2A owner or revise the
plan and define a stable, application-data location plus concurrency and migration semantics.

### 5. The runtime event bus and the standalone events crate are separate systems

**Priority: P2.**

The kernel uses `AgentBus` from the sibling `aphrody-subsystem` contract. The local
`aphrody-events::EventBus` is a separate implementation with subscribers and an NDJSON audit sink,
but no crate consumes it and there is no bridge from kernel events to its persistence path. Thus
the kernel's event stream is not automatically the durable/auditable event stream described by
the local events capability.

Evidence: [`kernel/src/lib.rs`](../../../../crates/aphrody-kernel/src/lib.rs) (`AgentBus` ownership),
[`events/src/lib.rs`](../../../../crates/aphrody-kernel/src/events.rs) (`EventBus`), and workspace dependency
metadata (no consumer of `aphrody-events`).

**Direction:** decide whether `aphrody-events` is a reusable library awaiting integration or an
obsolete parallel bus. If audit persistence is required, add an explicit nonblocking bridge with
defined overflow and shutdown behavior.

### 6. WinClean generated bindings lack a reproducible parity gate

**Priority: P2.**

The Rust catalog, Rust generated bindings, and Bun generated types are checked-in outputs, but no
generator is present under `scripts/` or the package. The integration verifier requires
`generated.ts` to exist but does not compare it to the Rust catalog or validate schema parity.
Current name sets do match (166/166), but that parity is not enforced by the verifier. In
addition, `Winclean.listTools()` advertises every tool with the generic schema
`{ type: "object" }`, even though the Rust catalog carries each input schema. This allows client
metadata and generated argument types to drift without the documented gate noticing.

Evidence: [`verify-winclean-integration.ts`](../../../../scripts/aphrody/audit/os/verify-winclean-integration.ts) (Bun port of the former `.ps1` verifier),
[`packages/os/winclean/src/index.ts`](../../../../packages/winclean/src/index.ts) (`listTools`),
[`packages/os/winclean/src/generated.ts`](../../../../packages/winclean/src/generated.ts), and
[`crates/os/kernel/comps/winclean/src/tools.json`](../../../crates/os/kernel/comps/winclean/src/tools.json).

**Direction:** check in or otherwise pin a deterministic generator and have the gate compare the
full tool-name/schema surface across Rust and Bun. Return the actual schema from `listTools()`.

### 7. The compatibility dispatcher contains operations owned by other architectural domains

**Priority: P2.**

`aphrody-winclean::dispatch` is a 1,700-line module combining compatibility routing with direct
implementations for coordination-file storage, Steam database queries, notifications, and other
operations. The convergence plan says domain crates own these capabilities and the kernel composes
them. In practice, some catalog entries route through this large compatibility module, and the
coordination implementation does not use its planned owner. This raises the cost of changing
compatibility contracts independently from domain behavior.

Evidence: [`dispatch.rs`](../../../crates/os/kernel/comps/winclean/src/dispatch.rs),
[`WINCLEAN-RUST-CONVERGENCE.md`](../../reference/os/WINCLEAN-RUST-CONVERGENCE.md), ownership matrix; file length and
module contents from the current checkout.

**Direction:** keep the frozen names and schemas at the compatibility boundary, but move behavior
into cohesive domain modules or owners and leave dispatch as argument conversion plus routing.

### 8. Resolved: obsolete `aphrody-os` re-export facade removed

The `aphrody-os` facade crate described in the original audit is absent from the current
workspace. Consumers use the owning capability crates directly; the remediation state is tracked
in [ARCHITECTURE-GAPS-STATUS.md](./ARCHITECTURE-GAPS-STATUS.md).

### 9. `aphrody-backend` is an out-of-layer product entry point

**Priority: P2.**

The workspace's documented product entry point is `aphrody-kernel`, but it also builds
`aphrody-backend`, whose binary identifies itself as “Google OS” and downloads Material Web and
Google Fonts assets into a VFS path rooted at `/var/mirror`. This behavior is not mapped in the
repository architecture or README ownership list. Further, `start_mirroring()` logs and suppresses
each download error, then returns success, so the binary can print “terminé avec succès” after
partial or total failure.

Evidence: `aphrody-backend/src/main.rs`,
[`aphrody-backend/src/lib.rs`](../../../../crates/aphrody-backend/src/lib.rs),
[`Cargo.toml`](../../Cargo.toml), and [`README.md`](../../products/os/README.md).

**Direction:** identify its owner and product role, or retire/move the crate. If retained, give the
mirror an explicit configuration and return an aggregate error when required assets fail.

### 10. Architecture documents disagree with the completed Rust-only runtime

**Priority: P2.**

The current convergence plan says all 166 tools dispatch to Rust and the NativeAOT migration is
complete. (upstream oxc doc, not vendored) still describes Rust handlers as replacing the legacy oracle
incrementally and lists NativeAOT as a Windows target component. Those statements conflict with
the completed, Rust-only WinClean product path and make the architecture index unreliable for
deciding what is implemented versus historical. References to external .NET compatibility support
may still be valid and are not counted as an error here.

Evidence: [`ARCHITECTURE.md`](./ARCHITECTURE.md) and
[`research/RUST-OS-ARCHITECTURE-AND-BAREMETAL-ANALYSIS.md`](./research/RUST-OS-ARCHITECTURE-AND-BAREMETAL-ANALYSIS.md)
compared with [`WINCLEAN-RUST-CONVERGENCE.md`](../../reference/os/WINCLEAN-RUST-CONVERGENCE.md), completion status.

**Direction:** mark dated target-state and historical material explicitly, remove obsolete runtime
claims from the current architecture overview, and state which roadmap rows remain open.

## Scope limits

This audit did not inspect sibling repositories, verify live Windows behavior, run tests, or
validate build/release gates. Several isolated crates may be intentionally reusable libraries;
their lack of a kernel consumer is recorded as an integration gap, not proof that the crate itself
is defective.
