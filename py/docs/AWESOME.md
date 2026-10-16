<!-- SPDX-License-Identifier: Apache-2.0 -->
# Awesome Rust, Python, Bun, UV, Tauri 3 & PyO3 Ecosystem (2026)

Curated reference of high-performance technologies, libraries, and canary-grade tooling powering the unified **Aphrody** and **rspyts** polyglot ecosystem.

---

## 1. Rust Ecosystem & High-Velocity Compute

- **[Rayon](https://crates.io/crates/rayon)** (`v1.12+`): Work-stealing data parallelism eliminating data races for multi-core processors. Transparent parallel iterators (`par_iter()`) for intensive numerical tasks.
- **[parking_lot](https://crates.io/crates/parking_lot)** (`v0.12+`): 1-byte synchronization primitives (`RwLock`, `Mutex`) utilizing Linux futexes directly without kernel memory allocation on uncontended paths.
- **[Serde](https://crates.io/crates/serde)** & **[serde_json](https://crates.io/crates/serde_json)** (`v1.0+`): Zero-copy serialization and deserialization framework for fast data interchange.
- **[Clap](https://crates.io/crates/clap)** (`v4.6+` with `clap_derive`): Compile-time typed command-line parsing without runtime reflection or interpretive overhead.
- **[simdutf8](https://crates.io/crates/simdutf8)**: AVX-512 and ARM NEON vectorized UTF-8 validation executing at bus bandwidth speeds (up to 20 GB/s).
- **[ndarray](https://crates.io/crates/ndarray)** (`v0.17+`): N-dimensional array processing in pure Rust with BLAS/LAPACK acceleration and memory layout guarantees.

---

## 2. Python, UV & Free-Threaded Runtime (PEP 703 No-GIL)

- **[Astral uv](https://github.com/astral-sh/uv)** (`v0.12+`): Unified package, virtual environment, and Python runtime manager written in Rust. Features the SAT-based `PubGrub` dependency solver and content-addressable storage (CAS) with hardlinks and reflinks.
- **[CPython 3.14t Free-Threaded](https://github.com/python/cpython)**: Native multi-threaded execution without the Global Interpreter Lock (PEP 703), incorporating `mimalloc` allocator pools and Biased Reference Counting.
- **[Maturin](https://github.com/PyO3/maturin)** (`v1.15+`): Zero-friction build system and wheel generator for Rust / PyO3 extension modules supporting `abi3` and free-threaded targets.
- **[Astral ty](https://github.com/astral-sh/ty)** & **[Ruff](https://github.com/astral-sh/ruff)**: Rust-powered linting, formatting, and incremental type-checking powered by Salsa's lazy dependency graph.
- **[Polars](https://github.com/pola-rs/polars)**: Fast columnar DataFrame engine designed in Rust on top of Apache Arrow IPC with lazy query optimization and parallel execution.
- **[Pydantic V2](https://github.com/pydantic/pydantic)**: Data validation and serialization executed in native Rust via the compiled `pydantic-core` engine.

---

## 3. PyO3 Native Interop Engine

- **[PyO3](https://github.com/PyO3/pyo3)** (`v0.29+`):
  - **`Bound<'py, T>` paradigm**: Deterministic lifetime management with strict RAII safety, deprecating raw pointer references.
  - **`py.detach()` delegation**: Replaces legacy `allow_threads()` to cleanly release the GIL and dispatch heavy computations to Rust thread pools (`Rayon`).
  - **Free-Threading readiness**: The `Ungil` marker trait enforces thread safety at compile time, guaranteeing that Python references never leak across thread boundaries.
  - **`abi3-py311` target**: Produces forward-compatible shared extensions that run across Python 3.11, 3.12, 3.13, and 3.14t.

---

## 4. Bun & Native TypeScript Runtime

- **[Bun](https://bun.sh)** (`v1.4.2+`): All-in-one JavaScript and TypeScript runtime written in Zig, providing an embedded bundler, test runner, package manager, and HTTP server.
- **`bun:ffi`**: Foreign function interface for calling native C (`extern "C"`) libraries directly by passing memory pointers (`ptr(TypedArray)`), bypassing N-API wrappers.
- **TypeScript 7**: Native compiler engine providing strict type checking and completion for FFI signatures.

---

## 5. OXC Toolchain (The JavaScript Oxidation Compiler)

- **[oxlint](https://oxc.rs)** (`v1.86+`): Rust-native JavaScript and TypeScript linter running hundreds of rules in under 30ms across thousands of source files (50x to 100x faster than ESLint).
- **[oxfmt](https://oxc.rs)** (`v0.71+`): High-speed code formatter engineered in Rust, providing strict adherence to ECMAScript and TypeScript AST specifications.

---

## 6. Desktop UI: Tauri 3 Alpha

- **[Tauri](https://github.com/tauri-apps/tauri)** (`v3.0.0-alpha.4` / `@aphrody/api 3.0.0-alpha.2`):
  - Lightweight system webview runtime generating compact binaries (<15 MB compared to >150 MB for Electron).
  - Direct IPC with zero serialization overhead between TypeScript interfaces and Rust backend actors.
  - Granular security access control lists (ACL) declared via structured schemas (`gen/schemas`).

---

## 7. Fullstack Rust Web Frameworks

- **[Axum](https://github.com/tokio-rs/axum)** (`v0.8.9`):
  - Official web framework from the **Tokio** project.
  - Capable of exceeding **250,000 requests/sec** under Hyper v1 with sub-15 MB memory footprints.
  - Native integration with the **Tower** middleware ecosystem (CORS, tracing, rate limiting, compression).
  - Compile-time type-checked request extractors (`Query`, `Json`, `Path`).
- **[Leptos](https://github.com/leptos-rs/leptos)** (`v0.9-beta`):
  - Fine-grained reactivity without a Virtual DOM, providing seamless server-side rendering (SSR) and client WebAssembly hydration.
- **[Actix-Web](https://github.com/actix/actix-web)** (`v4.9+`):
  - Battle-tested actor-based web framework with dedicated per-core event loops for maximum I/O throughput.
