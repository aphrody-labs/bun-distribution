<!-- SPDX-License-Identifier: Apache-2.0 -->
# Rspyts-guided Aphrody refactoring

Owner request, 2026-10-03: clone `aphrody-dev/rspyts` in `/tmp`, reorganize,
refactor, redesign, recode and rebuild all Aphrody according to its current
state, plan and the current Yolo stack. The complete request remains active.
This execution worklist supplements [Aphrody PLAN](../../../PLAN.md); it does
not replace its architecture, product obligations or success criteria.

## Verified inputs

- `/tmp/rspyts`: clean checkout, origin
  `https://github.com/aphrody-dev/rspyts.git`, HEAD
  `adecf388e0bbb4d90a9c91cc774af0ef6b8c1161`. GitHub reports a private repository.
- Aphrody started this batch on clean `main` at `84ec385cd`.
- Yolo was inspected on a clean checkout at `83b7790`. Its
  [plan](../../../../yolo/PLAN.md) and [memory](../../../../yolo/MEMORY.md)
  remain producer authority; source presence is distinct from release qualification.
- [October stack selection](../../reference/workspace/STACK-REPORT-2026-10.md)
  records React/Material 3 for applicative UI and Dioxus for selected Rust
  applications. This batch performs no visual redesign or cross-WebView qualification.

Rspyts offers a useful separation of neutral Rust logic, C exports, Bun clients
and Python bindings. Its inspected Bun binding directly loads
`target/release/librspyts_ffi.so`, while its exported function has no ABI
negotiation or structured error status. Its root build recompiles the Rust
workspace. These mechanisms do not meet Aphrody's versioned, precompiled Yolo
consumer contract and must not be transplanted as that contract.

Its layout conventions are reference material. Aphrody's existing domain
owners, Tauri resource conventions, package identities and separate Python
repository remain authoritative. Rspyts's documentation contains performance
and zero-copy claims; this task has not reproduced those measurements.
No source or dependencies were copied from the reference checkout.

## Full work queue and required evidence

| Work | Owner and end state | Acceptance evidence | Current status |
| --- | --- | --- | --- |
| Reference checkout | Rspyts available in `/tmp`, exact revision retained | Git origin, HEAD, clean status, privacy | Verified above |
| Workspace organization | Aphrody domain paths and inventories reflect the active owners | Current inventory, consumer imports, preserved identities, owner consistency gates | Open across the complete workspace |
| Native boundary | Yolo supplies versioned ABI, lightweight SDK, cancellation and explicit ownership | Negotiation/refusal, buffers, worker joins, destruction, isolated extension build | Existing initial slice; broader contract open |
| Process migration | Aphrody clients use qualified Yolo supervision | Before/after package tests, lossless output, timeout, abort, descendants, shutdown, downstream contracts | Engine correction below; one-shot service migration open |
| Desktop and UI redesign | Product screens use existing UI owners and selected stack through Tauri capabilities | Rendered pilot and product screens, adaptive behavior, permissions/refusals, events, clean exit, installed bundle | Open |
| Headless integration | Yolo distributes Obscura with its current engine, then qualifies JSC parity | Navigation, DOM extraction, captures, context isolation, consumer suite, installed artifact | R4/R5/R6 open; preserve V8 until parity |
| Product rewrite and rollout | Every affected application and integration retains its domain behavior through the SDK | Per-consumer dependency/build evidence and complete product contract suites, including Shenron, RG, Koharu and remaining applications | R7 open; existing engine wiring is only one consumer |
| Python integration | Aphrody-py keeps Python services and protected stores under its own plan | Local owner gates, typed bindings and native ownership for selected migrations | Open; no Python files changed |
| Rebuild and distribution | Workspace/Infra assembles verified Yolo releases and application artifacts for supported targets | Serialized factory builds, pinned hashes/provenance, install/upgrade/rollback, packaging and activation receipts | Open for the requested whole-system rebuild |
| Optimization | Routine application changes avoid heavy engine rebuilds, obsolete paths retire after qualification | Resolved dependency graphs, reproducible before/after build, size and memory measurements, rollback | Open; no gain claimed |

The ten success criteria in Aphrody PLAN section 15 remain required. Passing
the engine package cannot close R7 or the whole refactoring task. Runtime
production, application source, tests, packaged output, installation and
activation must each carry their own evidence.

## Implemented batch: engine lifetime

The completed source batch changes `packages/web/agent-browser/src/engine.ts`:

- Keep an engine in the tracked set until shutdown finishes, so
  `stopAllEngines()` waits for an already-running `stop()`.
- Release the native process handle when the engine exits naturally, preserving
  its actual exit code and captured diagnostics.
- Share the shutdown promise between explicit stop and exit monitoring, avoiding
  native status reads after handle release.

Six regression tests use the installed precompiled runtime and local executable
fixtures. They cover natural exit and native handle invalidation, concurrent
global shutdown, repeated start/stop, rejected startup, independent simultaneous
engines and SIGTERM-to-SIGKILL escalation. Global shutdown is tested in its own
host so the package's shared CDP engine stays usable.

The [batch receipt](../../migration/rspyts-native-engine-lifecycle-2026-10-03.json)
records commands, results and limitations. Rollback is a normal revert of the
completed batch; the SDK pin and installed runtime are unchanged.

## Next producer and consumer work

Two concrete SDK prerequisites were identified in current Yolo source:

1. `crates/yolo-runtime/src/process.rs` retains only the last 64 KiB per stream,
   and the SDK returns decoded strings. `WebService.bytes()` requires exact
   arbitrary bytes, and responses/crawls can exceed that bound. Qualify a
   lossless output transport in Yolo before replacing `service.ts`'s current
   `Bun.spawn` path. Test bursts exceeding 64 KiB, invalid UTF-8, concurrent
   streams, terminal drain, output limits, timeout and abort.
2. Capture readers are detached threads. Process release and runtime destruction
   must join owned workers before a consumer unloads the library. The producer
   also returns early from process-group stop when the leader already exited;
   surviving descendants need an explicit test and ownership decision.
   This consumer therefore keeps its shared library loaded. The engine tests
   prove direct-child cleanup and handle release, not full native-worker or
   descendant cleanup.

Implement these behind Yolo's existing owner, run serialized Rust and SDK gates,
produce a pinned archive with provenance, then migrate the consumer and qualify
its downstream applications. Heavy Bun/Tauri/Obscura builds use the configured
factory. Do not restart or stop existing host builds as part of this worklist.
