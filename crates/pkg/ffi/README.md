<!-- SPDX-License-Identifier: Apache-2.0 -->
# Native package store ABI

Small cdylib/rlib over `aphrody-pkg-store`, with no engine dependencies. ABI 1
checks opaque numeric handles and uses explicit lengths and UTF-8 host paths.
Read ABI version before other calls. Statuses distinguish input, I/O, integrity,
missing objects, existing destinations and caught panics. Requires unwind panic
profiles for recovery; `panic=abort` artifacts cannot recover a Rust panic.

Stores and buffers share a process registry. Release each returned handle once.
Store calls are synchronous and can run concurrently; release prevents future
calls, while a previously started call retains its store until completion.
Callers must synchronize wrapper disposal. Buffer copies append no terminator.
Inputs remain borrowed only during the call; no foreign pointer is retained.
Pointer validity remains the foreign caller's responsibility. No C ABI can catch
invalid/dangling addresses or OOM aborts. Last-error text is per calling thread:
capture it with `aphrody_pkg_error_message` before another status-returning call.
Its result uses the same length/copy/release protocol.

## Build and regenerate

Run through the repository's serialized Cargo owner:

```text
cargo build --locked -p aphrody-pkg-ffi
cargo test --locked -p aphrody-pkg-ffi
cargo clippy --locked -p aphrody-pkg-ffi --all-targets -- -D warnings
cbindgen --config crates/pkg/ffi/cbindgen.toml --crate aphrody-pkg-ffi --output crates/pkg/ffi/include/aphrody_pkg.h
```

The header has C++ guards; link the produced native library (Windows import
library `aphrody_pkg.dll.lib`, Unix `libaphrody_pkg.so`/`.dylib`). Keep the library
on the host's native loader path. Pass a fresh temporary store to every example;
none chooses or reconfigures provider/cache stores.

```text
python crates/pkg/ffi/examples/python/smoke.py <library> <store>
bun crates/pkg/ffi/examples/bun/smoke.ts <library> <store>
cargo run --locked -p aphrody-pkg-ffi --example rust -- <store>
dotnet run --project crates/pkg/ffi/examples/dotnet -- <store>
cmake -S crates/pkg/ffi/examples -B <build-dir> -DAPHRODY_PKG_LIBRARY=<native-link-library>
cmake --build <build-dir>
```

`examples/bun` provides the private `@aphrody/pkg` typed bun:ffi adapter.
`examples/dotnet` provides the P/Invoke adapter and `dotnet pack` metadata; native
NuGet inclusion requires explicit `NativeLibrary` and `RuntimeIdentifier`.
The Python ctypes smoke file loads the caller-selected library; wheel production
and public publishing remain release work. Examples are source implementations,
not a claim that every toolchain or native target has been executed.
