<!-- SPDX-License-Identifier: Apache-2.0 -->
# Engineering Best Practices: Aphrody Polyglot Architecture

This document details the architectural standards, memory safety invariants, concurrency primitives, and packaging doctrines applied across **Aphrody Python** in convergence with the Aphrody polyglot monorepo (Rust, Python uv, PyO3 0.29, Bun TypeScript, and Tauri 3).

---

## 1. Rust Compute Core & C-ABI FFI Architecture

High-performance computing components are decoupled into pure algorithmic engines and lightweight FFI adapter layers.

### Single Responsibility & Algorithmic Purity

Algorithmic logic (vector normalization, cosine similarity, reciprocal rank fusion, matrix operations) lives in dedicated Rust modules with zero Python runtime dependencies:

- **Algorithmic isolation**: Core functions accept pure Rust primitives or contiguous memory slices (`&[f32]`, `&[f64]`) rather than allocating intermediate `Vec<T>`.
- **Data parallelism**: Heavy loops utilize [Rayon](https://crates.io/crates/rayon) work-stealing iterators (`par_iter()`) for transparent multi-core scaling.
- **Microsecond synchronization**: Shared state is guarded by `parking_lot::RwLock` or `parking_lot::Mutex`, avoiding Linux kernel futex allocations when uncontended.

### Safe C-ABI Exports & Pointer Validity (Rust 2024)

When exposing C-ABI entry points for foreign runtimes (such as `bun:ffi` or foreign loaders):

```rust
// Exported C-ABI entry point respecting Rust 2024 edition unsafe attributes
#[unsafe(no_mangle)]
pub unsafe extern "C" fn ffi_cosine_similarity(
    ptr_a: *const f64,
    ptr_b: *const f64,
    len: usize,
) -> f64 {
    if ptr_a.is_null() || ptr_b.is_null() || len == 0 {
        return 0.0;
    }
    // Explicit slice construction within unsafe scope with checked length
    let slice_a = unsafe { std::slice::from_raw_parts(ptr_a, len) };
    let slice_b = unsafe { std::slice::from_raw_parts(ptr_b, len) };

    aphrody_core::compute_cosine_similarity(slice_a, slice_b)
}
```

Key invariants:
- Always check pointers for nullability and zero lengths before slice construction.
- Ensure pointer alignment matches the underlying element type (`f32` / `f64`).
- Lifetimes of constructed slices must never outlive the caller's buffer.

---

## 2. PyO3 0.29 Concurrency & Free-Threaded Python (PEP 703 No-GIL)

Python 3.13+ and 3.14t introduce GIL-free multi-threading. PyO3 0.29 provides first-class primitives to safely coordinate across threads.

### Safe Thread Detachment: `py.detach()` vs Legacy `allow_threads()`

In PyO3 0.29+, compute-heavy tasks must release the GIL using `py.detach()`. Unlike the deprecated `allow_threads()`, `py.detach()` requires the closure to satisfy the `Ungil` trait:

```rust
use pyo3::prelude::*;

#[pyfunction]
pub fn parallel_normalize_embeddings(
    py: Python<'_>,
    data: Vec<f32>,
    rows: usize,
    width: usize,
) -> PyResult<Vec<f32>> {
    // py.detach releases the GIL and statically verifies that the closure
    // does not capture non-thread-safe Python references (Ungil trait).
    let normalized = py.detach(move || {
        aphrody_core::normalize_matrix_par(&data, rows, width)
    });

    Ok(normalized)
}
```

Benefits of `py.detach()`:
- **Compile-time safety**: Prevents data races by forbidding Python `Bound<'py, T>` objects from crossing thread boundaries.
- **Free-Threading compatibility**: Integrates cleanly with CPython 3.14t biased reference counting and `mimalloc` allocator pools.

### Deterministic Lifetime Management: `Bound<'py, T>`

All PyO3 interfaces use `Bound<'py, T>` rather than raw pointer references or legacy `&'py PyAny`:
- Strict RAII scoping tied directly to the GIL token `'py`.
- Immediate release of Python object references when leaving local scope.
- Explicit conversions via `.extract::<T>()` and `.into_pyobject(py)`.

---

## 3. Zero-Copy Memory & Data Pipeline Architecture

Cross-language interoperability must avoid memory duplication and serialization serialization bottlenecks.

### Direct Buffer Passing & Memoryview Protocol

For vector and matrix operations, native functions operate directly on raw binary buffers (`bytes`, `bytearray`, or `memoryview`):

```python
# Zero-copy buffer ingestion in Python
import memoryview
from aphrody.aphrody_rust import normalize_embeddings_f32


def process_large_embeddings(raw_buffer: bytes, rows: int, width: int) -> memoryview:
    # Native function receives pointer directly from Python buffer protocol
    result_bytes = normalize_embeddings_f32(raw_buffer, rows, width)
    return memoryview(result_bytes)
```

In the native PyO3 layer:
- Ingest input via `&[u8]` borrowed directly from Python's internal buffer.
- Cast slice memory safely via `bytemuck` or `zerocopy` into `&[f32]` without copying heap buffers.
- Construct the output `PyByteArray` or `PyBytes` directly in the target buffer.

### Apache Arrow IPC & Polars Integration

When transferring large structured tabular or columnar datasets:
- Use the **Apache Arrow C Data Interface** or **Arrow IPC streaming format**.
- Arrow buffers share memory pages between Rust and Python without copying.
- In Python, wrap Arrow memory structures into Polars DataFrames using `pl.from_arrow()` without copying the buffers.

### Bun TypeScript Zero-Copy FFI (`bun:ffi`)

For TypeScript runtimes calling native Rust libraries via Bun:
- Avoid converting `Float64Array` or `Float32Array` into JavaScript arrays (`Array.from` or `.map`).
- Pass the underlying memory address directly with `ptr(typedArray)`:

```typescript
import { dlopen, FFIType, ptr } from "bun:ffi";

const { symbols } = dlopen(libraryPath, {
  ffi_cosine_similarity: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.usize],
    returns: FFIType.f64,
  },
});

export function computeCosine(a: Float64Array, b: Float64Array): number {
  if (a.length !== b.length || a.length === 0) return 0.0;
  return symbols.ffi_cosine_similarity(ptr(a), ptr(b), a.length);
}
```

---

## 4. PEP 484 & PEP 561 Typing Standards

Strict static typing guarantees reliability across all workspace modules and external consumers.

### Package Type Markers (`py.typed`)

Every published package and workspace member must declare PEP 561 typing support:
- Include an empty `py.typed` file in the package's top-level module:
  - `packages/aphrody/src/aphrody/py.typed`
  - `packages/aphrody-train/src/aphrody_train/py.typed`
  - `packages/cli/src/aphrody_cli/py.typed`
  - `packages/embedding-fixtures/src/aphrody_embedding_fixtures/py.typed`
  - `packages/model-tools/src/koharu_model_tools/py.typed`
  - `apps/meetings/src/aphrody_meetings/py.typed`

### Explicit Native Stubs (`.pyi`)

All compiled PyO3 and C-ABI modules must be accompanied by an exhaustive `.pyi` interface stub file:
- Located alongside the native extension: [`packages/aphrody/src/aphrody/aphrody_rust.pyi`](../packages/aphrody/src/aphrody/aphrody_rust.pyi).
- Documents exact argument types, keyword arguments, return types, and docstrings.
- Checked by both `mypy` and `ty` during validation passes.

---

## 5. Toolchain & Code Quality

Linting, formatting and type checks run through Rust-native tools.

### Ruff & Astral Ty Integration

- **Ruff**: Enforces strict code formatting, import sorting, and linting rules (target Python 3.12+).
- **Astral Ty**: Static type analysis leveraging Salsa incremental computation.
- Configuration resides centrally in [pyproject.toml](../pyproject.toml) under `[tool.ruff]` and `[tool.ty]`.

### OXC Toolchain for Web & Hybrid Components

Where TypeScript or web interfaces are developed alongside Python services:
- Replace ESLint and Prettier with `oxlint` and `oxfmt`.
- Run them in local loops and in continuous integration with the same configuration.

---

## 6. Packaging Isolation & Native Wheel Verification

Strict rules govern package distributions to prevent host leaks and cross-project pollution.

### Pinned Source Builds & Standalone Packaging

- Native extensions build from pinned source recipes using Maturin and Cargo.
- Extension wheels target `abi3` (e.g., `abi3-py311`), enabling a single binary wheel to execute across Python 3.11, 3.12, 3.13, and 3.14.
- **No checkout-neighbor dependencies**: A package must never rely on runtime files located in neighbor repositories or sibling directories outside its declared package dependencies.

### Automated Workspace Verification

The workspace modernization script validates every member in fresh isolated environments:

```bash
# Verify standalone locks, wheels, and manifests across all workspace members
python tools/packaging/modernize_workspace.py check
```

Validation checklist:
1. All package `pyproject.toml` files specify valid versions and clean dependencies.
2. Every package builds a clean wheel without undeclared build-time tools.
3. Wheels install and pass test suites in isolated clean staging directories.
4. Git checkouts remain clean of build artifacts, model checkpoints, and secrets.
