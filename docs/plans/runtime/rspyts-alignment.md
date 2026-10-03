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
| Native boundary | Yolo supplies versioned ABI, lightweight SDK, cancellation and explicit ownership | Negotiation/refusal, buffers, worker joins, destruction, isolated extension build | ABI 1.4 process slice qualified; extension/desktop/browser contract open |
| Process migration | Aphrody clients use qualified Yolo supervision | Before/after package tests, lossless output, timeout, abort, descendants, shutdown, downstream contracts | Engine and one-shot service migrated; downstream gates qualified |
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

## Implemented batch: lossless Web supervision

Yolo ABI 1.4 joins native capture workers, stops the owned Unix group after
leader exit, preserves arbitrary stdout/stderr bytes and rejects overflow
instead of silently truncating. The SDK checks lifetimes before native calls,
including in-flight HTTP probes. Its shared owner has 32 bounded slots for
processes and readiness operations. Producer commits are `01300fb2f935` and
`0ade1c71ccb5`; Linux x64 packaging records clean provenance and matching
embedded revision.

Aphrody pins SDK archive `5334dbe9`. WebService uses the shared native
supervisor for all one-shot calls, retaining command arguments, private-network
options, binary bodies, diagnostics, exit codes, timeout and caller abort
reasons. Engine supervision uses the same owner. The service's direct Bun
spawn path, consumer runtime singleton and manual exit-kill fallback are removed.

Nine native fixtures extend the Web suite to 50 passing tests; native timeout,
overflow and abort tests verify that the child is gone and its handle released.
The [consumer receipt](../../migration/runtime-web-consumer-2026-10-03.json)
records the producer artifact, archive pin and downstream tests. Installation
is local; no complete product deployment or measured speedup is inferred.

## Next implementation

1. Reproducible SDK/runtime acquisition for clean consumers and factory builds.
   The current catalog pin refers to an ignored cache file. Replace that
   prerequisite with a verified producer artifact acquisition workflow; do not
   copy engine sources or rebuild them inside consumer install.
2. R3 desktop pilot through the existing Tauri owner: rendered window,
   permissions/refusals, events, cancellation, clean shutdown and installed bundle.
3. R4 headless distribution through the existing Obscura owner; retain V8 until
   the required JSC parity passes. Then proceed across all R7 product owners.
4. Complete target-specific release/install/upgrade/rollback gates and measured
   optimization. Windows native execution and process-tree Job Objects remain open.

The whole work queue above stays active. Do not close the user request from
these two process batches. Heavy Bun/Tauri/Obscura builds use the configured
factory; preserve other running builds and private domain stores.
