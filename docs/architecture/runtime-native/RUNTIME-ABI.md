<!-- SPDX-License-Identifier: Apache-2.0 -->

# Runtime C ABI (slice R0, ABI 1.4)

First vertical slice of [PLAN.md](../../../PLAN.md) phase R0: one capability family behind a versioned
C ABI, a precompiled artifact and a light TypeScript consumer. Nothing here qualifies later
phases.

| Piece                      | Path                                                      |
| :------------------------- | :-------------------------------------------------------- |
| Library (cdylib + rlib)    | `crates/engine/yolo-runtime`                                     |
| C header                   | `crates/interop/ffi/include/aphrody.h` (canonical main header of `aphrody_ffi`; packaged `yolo_runtime.h` is a compatibility include) |
| TypeScript SDK (`bun:ffi`) | `packages/engine/runtime`                                             |
| Artifact packaging         | `scripts/release/runtime_artifact.ts` → `dist/runtime/<target>/`  |
| Tests                      | `cargo test -p yolo-runtime`, `test/runtime_sdk.test.ts` |

The main header merges the former `yolo_runtime.h` declarations. Optional feature
interfaces remain in `crates/interop/ffi/include/aphrody-tooling.h`,
`crates/interop/ffi/include/aphrody-inference.h` and
`crates/interop/ffi/include/aphrody-web-pipeline.h`. A single main header does not
establish complete CLI/FFI/MCP/kernel parity, runtime availability, installation
or qualification on every platform.

```bash
just runtime-build      # cargo build --profile runtime -p aphrody-ffi --features browser,tooling
just runtime-package    # library + header + manifest.json (target, toolchain, ABI, revisions, hashes)
just runtime-test       # Rust unit tests + Bun SDK tests
bun run packages/runtime/examples/stats.ts
```

## Capabilities

| Id              | Entry points                                             | Backed by                                  |
| :-------------- | :------------------------------------------------------- | :----------------------------------------- |
| `system.stats`  | `yolo_system_stats`                                      | `yolo_core::current_system_stats`          |
| `bench.compute` | `yolo_bench_start`, `yolo_operation_wait/cancel/release` | `yolo_core::compute_benchmark_cancellable` |

| `process.supervise` | `yolo_process_spawn/status/read/stop/release` | `std::process` with Unix process-group shutdown; direct-child shutdown on Windows |
| `http.probe` | `yolo_http_probe_start` (an operation: the caller is never blocked) | `std::net`, HTTP/1.0 `GET` |

`system.stats` and `bench.compute` were picked because they already existed and need no engine.
`process.supervise` and `http.probe` are the first real shared service (decision D10 in
[DECISIONS](../../decisions/runtime/DECISIONS.md)); the TypeScript surface is `runtime:system` and `runtime:process`, loaded
by the preload plugin of `packages/engine/runtime`.

## Contract

- **Versioning.** `yolo_abi_version()` returns `(major << 16) | minor`. A consumer calls it first
  and refuses another major before any other call (the SDK does). `yolo_runtime_create` receives
  `struct_size`, `abi_major`, `abi_minor`: a different major or a newer minor is `ABI_MISMATCH`, a
  caller built against a smaller structure is accepted with defaults for the missing fields.
- **Handles.** Objects are opaque 64-bit handles (slot index + generation). A destroyed or
  recycled handle is rejected with `INVALID_HANDLE`; a runtime handle is not valid where an
  operation handle is expected. No raw pointer to library state leaves the library.
- **Buffers.** Returned buffers (`YoloBuffer`: data, len, cap) belong to the library. The caller
  reads only `len` initialized bytes and preserves all three fields until `yolo_buffer_free`,
  which uses the library's allocator and zeroes the struct (a second call is a no-op).
  The native transfer retains the original allocation without shrinking or copying; `cap` may
  exceed `len`, and that capacity remains allocated until release, even when `len` is zero.
  The Bun SDK still copies bytes before freeing them; this does not make JS reads zero-copy.
  The library never frees caller memory and never keeps a pointer to it.
- **Errors.** Every function returns a `YoloStatus`. Details of the last failure of the calling
  thread are available as JSON through `yolo_last_error`. Structured control data (build info,
  capabilities, stats) is JSON; high-volume data paths will use dedicated buffers when they exist.
- **Panics.** Every entry point catches panics and returns `PANIC`, and worker threads report a
  failed operation instead of dying silently. This requires unwinding: the artifact is built with the
  dedicated `runtime` profile (`inherits = "release"`, `panic = "unwind"`) and
  `build_info().panic_recovery` tells the consumer which behavior it got. The plain release profile
  (`panic = "abort"`) is not used for this artifact; the profile is a per-artifact decision, not a
  per-package override.
- **Threads and lifetime.** Operations run on bounded worker threads (`max_operations`, default 4,
  at most 64; `BUSY` beyond). `wait` takes a timeout (`TIMEOUT` leaves the operation valid),
  `cancel` is idempotent and polled by the worker, `release` cancels, joins and invalidates.
  `yolo_runtime_destroy` cancels and joins every operation of the runtime before it invalidates it,
  so unloading the library after destroy cannot leave a running worker.
  Processes count against the same limit and are stopped (group SIGTERM, 500 ms grace, SIGKILL)
  when their runtime is destroyed. Capture workers are also joined before stop/release/destroy
  returns. Unix shutdown signals surviving group members even after the leader exits. Windows
  currently stops the direct child; process-tree ownership through Job Objects is not qualified.
  SDK process and operation handles reject calls after runtime close without entering the
  unloaded library. Handles are thread-safe: any thread may call any function.
- **Versioning policy.** ABI 1.x is additive only (D1): 1.0 is the core, 1.1 added the process and
  probe functions, 1.2 the bounded stdout/stderr capture (`YOLO_SPAWN_CAPTURE`, `yolo_process_read`: the
  last 64 KiB of each stream, drained or peeked). `yolo_process_stop_start` (1.3) is the non-blocking stop. An older library is refused by the SDK with an ABI error before any symbol other
  than `yolo_abi_version` is bound.
  ABI 1.4 adds lossless byte capture, an optional per-stream budget and output completion.

## What the light consumer needs

`packages/engine/runtime/src/index.ts` and the prebuilt artifact. `cargo tree -p yolo-runtime` lists 13
packages (serde, serde_json and their proc-macro chain, `yolo-core`, the crate itself); Tauri, wry,
tao, WebKitGTK, Bun and Obscura are absent from the graph. On the development machine the artifact
is about 410 KB and one incremental build took 3 s; no comparison with the desktop stack has been
measured, so no saving is claimed.

## Not claimed

- The R1 host is the SDK preload (`bun:ffi` + `Bun.plugin`), by decision D5; the Bun fork is not
  modified.
- R2 is limited as stated in D11: the consumer's supervision code is retired, the Obscura binary is
  not (R4).
- Only Linux x64 runtime behavior and packaging are qualified by this batch. Windows x64,
  macOS x64/ARM64 and Linux ARM64 pass metadata checks; execution, signing and complete
  distribution on those targets remain open. Artifact install/rollback is covered by release tests;
  `manifest.json` alone does not qualify an artifact.

## ABI 1.4: complete binary output

`YOLO_SPAWN_CAPTURE` retains its bounded 64 KiB diagnostic tail. Select
`YOLO_SPAWN_CAPTURE_LOSSLESS` (flag 4) for full stdout/stderr bytes. The original
40-byte `YoloSpawnInfo` remains accepted with a default 64 MiB budget per stream.
`YoloSpawnInfoV14` appends a `capture_limit` u64: set `base.struct_size` to the
extended size and pass `&info.base`. Zero selects the default; positive budgets
must not exceed 64 MiB. A budget counts all bytes produced during the process
lifetime, including bytes already drained.

An overflow is persistent `YOLO_OUTPUT_LIMIT` (status 9), never a successful
truncated response. Workers continue draining after overflow so pipe pressure
cannot deadlock the child. `yolo_process_output_complete` reports whether both
readers finished; `yolo_process_read` still reports any output-limit or I/O error.
Returned bytes use the existing library-owned `YoloBuffer` and free contract.

The SDK exposes `takeStdoutBytes`, `takeStderrBytes`, `outputComplete` and
`collectOutput`. Collection polls without blocking the JS event loop, copies
buffers before freeing them, joins readers for the final drain, and stops the
owned child before rejecting a timeout, abort or output error. The caller still
owns the process handle and releases it. `capture-lossless` has an explicit
64 MiB default per-stream ceiling; a product requiring larger payloads needs a
separately qualified streaming contract.

Pipe readers use nonblocking descriptors on Unix. On Windows they use a sole
reader and [PeekNamedPipe](https://learn.microsoft.com/en-us/windows/win32/api/namedpipeapi/nf-namedpipeapi-peeknamedpipe)
before reading available bytes from the borrowed
[AsRawHandle](https://doc.rust-lang.org/std/os/windows/io/trait.AsRawHandle.html).
Cancellation bounds worker teardown even if an escaped descendant keeps a pipe
open; a lossless reader then reports an incomplete-output error. Escaped process
groups are outside the owned group and are not silently claimed terminated.
Runtime execution on Windows/macOS/ARM remains separate from cross-target checks.

The producer packager selects `target/runtime/` (not in repo) (generated or machine-local artifact; availability depends on the build host) (or an explicit
`YOLO_RUNTIME_LIB`), independently of the runtime installed by the developer.
The `runtime-test` recipe uses that same build for SDK tests. Build provenance
also tracks the current Git ref and packed refs, so a new commit on the same
branch refreshes the embedded revision.
