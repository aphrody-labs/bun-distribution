# Unifying the workspace into `iecode-core`

## Findings from current toolchain documentation

Cargo workspaces manage multiple packages with one lockfile, output directory, shared metadata
and workspace dependencies. They do not require every package to become one crate, and path
dependencies inside the workspace are automatically members unless excluded. The correct end
state here is an intentional package collapse, not a nested workspace or a glob that pulls tools
into the core. See the [Cargo workspace reference](https://doc.rust-lang.org/cargo/reference/workspaces.html).

Rust's FFI guidance requires an explicit foreign ABI and careful ownership/error handling; Rust
layout is not the cross-language contract. The [Rustonomicon FFI chapter](https://doc.rust-lang.org/nomicon/ffi.html)
is the ABI baseline. .NET Native AOT exports only explicitly annotated `UnmanagedCallersOnly`
methods with entry points, as documented by [Microsoft's native interop guide](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/interop).
CMake remains the native build coordinator, not a second Rust package manager; keep native
profiles in the existing [CMake Presets format](https://cmake.org/cmake/help/latest/manual/cmake-presets.7.html).

## Target graph

```text
iecode-core (Rust library)
├── default: pure formats, crypto, geometry, archive, RE, API contracts
├── feature = sql: SQLite/PostgreSQL boundary
├── feature = host: async jobs and host integrations
├── feature = video: frame/video adapters
├── feature = cpp-backend: generated C bindings to optional iecode_core
└── feature = dotnet-backend: C ABI calls to optional Native AOT bridge

iecode (Rust CLI) ───────────────┐
Bun / WASM / API bindings ───────┼── typed Rust API / schema
C++ consumers ── C ABI adapter ──┤
.NET consumers ─ C ABI adapter ──┘
Python consumers ─ generated bindings or files/schema
```

## ABI contract

The public bridge uses opaque handles and caller-owned buffers only:

```c
typedef struct iecode_error {
  uint32_t code;
  const uint8_t *message;
  size_t message_len;
} iecode_error;

int32_t iecode_core_version(uint32_t *major, uint32_t *minor, uint32_t *patch);
int32_t iecode_core_execute_json(
  const uint8_t *request, size_t request_len,
  uint8_t *response, size_t response_capacity, size_t *response_len,
  iecode_error *error);
void iecode_core_free_buffer(uint8_t *buffer, size_t length);
```

The exact symbols must be versioned before publication. No C++ STL, C# object, Rust reference,
Rust enum layout, exception or panic crosses the boundary. Every exported function must be
`extern "C"`, null/length checked, panic-contained, deterministic about ownership and covered by
a C, C# and Rust fixture.

## Migration sequence

1. Add `crates/core/Cargo.toml` as `iecode-core` and move the six existing Rust library modules
   behind `crates/core/src/*`, preserving their public tests and features.
2. Make `iecode-cli` depend only on `iecode-core`; keep command parsing and presentation in the
   CLI. Remove direct CLI dependencies on individual implementation crates.
3. Add `core::api` request/response types and golden JSON/byte fixtures. The fixture is the proof
   boundary for every C++/.NET port or backend.
4. Extract pure C++ operations from the source glob into a separately named native target and
   expose only the C ABI adapter. Remove `main`, tests, network, database and game runtime sources
   from the library target.
5. Extract pure C# operations into `IECODE.Core` namespaces with no command handlers or process
   side effects. Add a tiny Native AOT export project containing only ABI functions.
6. Generate or hand-maintain bindings from the ABI header for Bun, C# and Python. Their tests
   must compare the same fixtures, not compare subprocess text.
7. Port one capability at a time to Rust, switch the default implementation to Rust, retain the
   foreign backend behind a feature for parity/performance, then remove it only after equal,
   non-zero counts on all supported targets.
8. Reduce the Cargo workspace to `crates/core` and `apps/iecode-cli` (plus a dedicated FFI package only if
   Cargo's crate-type/release constraints require it). Keep CMake, .NET and uv as build surfaces,
   not as additional Rust core packages.

## Required gates

- `cargo test -p iecode-core --all-features --locked` and `cargo clippy -p iecode-core --all-targets --all-features -- -D warnings`;
- C ABI smoke tests on Linux and Windows with null, short-buffer, invalid-UTF-8 and panic paths;
- C++ and .NET fixtures with equal input/output/error counts;
- `dotnet publish` Native AOT only for the tiny export project, never the whole object graph;
- Bun/Python tests consuming the same JSON schema;
- CMake native target and vcpkg lock/configuration checks;
- `cargo check --target wasm32-unknown-unknown` with host/database/native features disabled.

## Completion rule

The workspace is unified when `iecode` and all bindings call `iecode-core`, there is one source of
truth for each capability, no CLI invokes another CLI, foreign implementations are optional
backends behind the C ABI, and parity fixtures have non-zero equal counts. Merely having one
`Cargo.toml`, or compiling the C++/C# trees beside Rust, is not completion.
