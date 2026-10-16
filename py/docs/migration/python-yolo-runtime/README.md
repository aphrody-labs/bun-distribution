<!-- SPDX-License-Identifier: Apache-2.0 -->
# Python consumer of native Yolo C ABI

`aphrody.yolo_runtime` is a standard-library `ctypes` adapter to the producer's
additive ABI 1.4. It loads an existing, verified precompiled artifact and delegates
system statistics, compute benchmarks, process ownership/capture/stop and HTTP
probes to Yolo. It creates no engine, subprocess supervisor, installer, cache,
credential store or desktop implementation.

```python
import sys
from aphrody.yolo_runtime import Runtime

with Runtime() as runtime:
    print(runtime.build_info())
    print(runtime.stats())
    with runtime.bench(1000) as operation:
        print(operation.wait(5000))
    with runtime.spawn(sys.executable, ("--version",)) as process:
        process.stop()  # explicit lifecycle example; callers choose completion policy
        print(process.read())
```

Discovery follows the installed producer layout: explicit `YOLO_RUNTIME_LIB`
(and sibling manifest), `YOLO_RUNTIME_HOME`, `YOLO_HOME/runtime`, otherwise
`~/.yolo/runtime/<host-target>/current`. `Runtime(Path(...))` selects an explicit
artifact directory. There is no neighbor-checkout runtime dependency or build
fallback. No production code contains development-machine paths.

Before `ctypes.CDLL`, the adapter verifies schema/name, host target, ABI 1.4+,
a clean full producer Git revision, panic recovery, exactly one shared library,
header presence, every payload's SHA-256 and byte length, and local regular-file
paths without payload symlinks. The loaded ABI is checked before other symbols
are bound. Embedded revision (producer emits a 12-hex abbreviation), target and
panic recovery must match the manifest. Hash verification establishes local
manifest consistency, not publisher authenticity; trusted artifact provisioning
belongs to the existing release owner. Mutating an installation concurrently
with loading is outside the immutable-release installation contract.

All signatures use the official C header's widths/alignment and opaque `uint64`
handles. Library-owned buffers are copied then freed in `finally`, including
failure paths. Runtime and handle context managers delegate cancellation, joins
and shutdown to native owners. No destructor unloads a live library. Explicit
`close()` is idempotent; calls on closed runtime/handles fail before entering C.
The library stays loaded while Python objects hold it. A reentrant lock serializes
calls against close; long operation waits therefore delay other Python calls on
that Runtime. Cancellation from another Python thread should use bounded waits
rather than an infinite wait. The C owner remains thread-safe.

Operation TIMEOUT (status 5) leaves the operation usable; cancel/release remain
native. Process reads return binary bytes; stdout/stderr capture uses ABI 1.4
lossless mode and a bounded per-stream budget. OUTPUT_LIMIT (9) remains a failure,
never successful truncation. The module does not implement a second polling
orchestration loop: callers choose completion policies using status/output_complete.
Asynchronous stop returns a native Operation requiring release. Capabilities
outside the advertised list (including desktop/headless) fail explicitly.

Supported discovery mappings match the producer: Linux x64/ARM64, macOS
x64/ARM64 and Windows x64. Only this host's Linux x64 installed artifact has
actual execution proof. Windows direct-child ownership (not Job Objects), macOS,
ARM64, signed distributions, new producer revisions and full desktop/headless
behavior remain unqualified; metadata mappings are not execution proof.
