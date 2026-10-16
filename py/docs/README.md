<!-- SPDX-License-Identifier: Apache-2.0 -->
# Technical Documentation & Quickstart: Aphrody Python Workspace

This directory gathers technical specifications, architectural designs, best practices, and curated references for the **Aphrody Python** workspace, reflecting the high-performance polyglot architecture inspired by **`rspyts`** (Rust, Python uv, PyO3 0.29, and Bun TypeScript).

---

## 1. Polyglot Architecture Pillars

The workspace unifies high-performance systems programming with productive Python workflows across five foundational pillars:

1. **Rust Compute Core & Native Extension (`aphrody_rust`)**:
   - Heavy vector calculations, SIMD normalization, and ranking algorithms execute inside a dedicated Rust crate compiled with edition 2024.
   - Built with PyO3 0.29 using the `abi3-py311` stable ABI target (`aphrody_rust.abi3.so`).
   - Algorithmic isolation: pure mathematical calculations avoid Python runtime state, freeing compute threads cleanly.

2. **Astral uv Package Management**:
   - Monorepo workspace governed by `uv.lock` with deterministic SAT resolution via the `PubGrub` algorithm.
   - Global content-addressable storage (CAS) leveraging filesystem hardlinks and reflinks so installs do not copy package files.
   - Pinned minimum uv version (`==0.12.22`) enforcing reproducible dependency trees across developers and CI.

3. **Free-Threaded CPython (PEP 703 No-GIL)**:
   - Architecture prepared for CPython 3.14t free-threaded execution.
   - Memory management backed by `mimalloc` to prevent allocator lock contention across parallel OS threads.
   - Compile-time concurrency validation via the PyO3 `Ungil` trait, preventing non-thread-safe Python objects from crossing thread boundaries.

4. **Zero-Copy Memory Pipelines (Apache Arrow & Polars)**:
   - Data buffers transfer between Rust compute engines and Python runtimes without serialization or memory duplication.
   - Direct exposure of contiguous memory slices (`&[f32]`, `&[f64]`) via Python buffer protocol (`bytes`, `bytearray`, `memoryview`) and Arrow IPC record batches.
   - Direct compatibility with Polars DataFrames for analytical queries.

5. **Rust-Native Developer Toolchain**:
   - Code formatting and linting powered by **Ruff**.
   - Type analysis configured with **Astral Ty** rules and **mypy** strict typing.
   - Unified task orchestration powered by **Bun**.

---

## 2. Quickstart & Command Reference

The workspace is driven by `yolo py` (the `vu` runtime's uv when installed) or by uv directly.

### Task orchestration with `yolo py`

All high-level engineering workflows are `yolo py` subcommands ([supervisor](../../packages/workspace/src/python-workspace.ts)):

```bash
# Apply workspace modernization and sync native components
yolo py build

# Run the complete workspace verification gate (tests, packages, manifests)
yolo py check

# Execute pytest test suites without re-sync overhead
yolo py test

# Run all test gates and package qualifications
yolo py check

# Lint codebase with Ruff
yolo py lint

# Format Python files with Ruff
yolo py fmt

# Run static type checking with mypy across all packages
yolo py typecheck
```

### Direct Package Management with uv

Dependencies and environments are managed with `uv`:

```bash
# Synchronize all workspace members and dev dependencies
uv sync

# Run targeted pytest on a specific package
uv run --no-sync pytest packages/aphrody/tests

# Inspect the workspace dependency tree
uv tree

# Update lockfile deterministically
uv lock
```

### PyO3 Native Build Workflow

The native extension module is the Rust workspace crate `crates/ai/rag-python`, built in place by maturin (see [native build](sdk/native-build.md)); build on the serialized build host, never in WSL:

```bash
# Rebuild the ABI3 native extension into a wheel
uv build --wheel packages/aphrody --out-dir dist
```

---

## 3. Workspace Layout & Package Catalog

The workspace structure separates reusable libraries, command-line interfaces, and domain applications:

```text
py/
├── packages/
│   ├── aphrody/             # Core library: PyO3 native bindings, vector math, ranking
│   ├── aphrody-train/       # Model training, dataset generation, and evaluation harness
│   ├── cli/                 # Unified Aphrody CLI frontend (aphrody_cli)
│   ├── embedding-fixtures/  # Reference vector embeddings and evaluation gold standards
│   └── model-tools/         # Quantization, conversion, and validation utilities
├── apps/
│   └── meetings/            # Meeting intelligence service, audio capture, and transcripts
├── tools/
│   ├── packaging/           # Packaging modernization and manifest validation tools
│   └── infra/               # Infrastructure, deployment, and benchmark scripts
├── docs/                    # Technical documentation and architectural guides
├── pyproject.toml           # Root uv workspace configuration & tool settings
└── package.json             # Root task runner scripts (Bun)
```

Each package ships with a PEP 561 [`py.typed`](../packages/aphrody/src/aphrody/py.typed) marker file and complete PEP 484 type signatures.

---

## 4. Documentation Index & Navigation

Explore the specialized guides and architectural references across the workspace:

- **[Documentation Master Index](INDEX.md)**: Exhaustive directory listing all guides, manifests, and plans.
- **[Engineering Best Practices](BEST_PRACTICES.md)**: Deep technical guidelines on zero-copy memory, PyO3 0.29 `Ungil` thread detachment, typing stubs, and C-ABI safety.
- **[Curated 2026 Ecosystem Reference](AWESOME.md)**: Technology matrix covering Rayon, parking_lot, uv, ty, CPython 3.14t, Polars, Pydantic V2, Bun 1.4+, and OXC.
- **[Rust-Python Convergence Research Report](RAPPORT_RUST_PYTHON_RESEARCH.md)**: Analytical deep-dive into the 5 pillars of Python modern architecture with benchmark results.
- **[Aphrody SDK Guide](sdk/README.md)**: Developer documentation for consuming the Aphrody Python SDK.
- **[Native SDK Packaging Plan](sdk/native-build.md)**: Build matrix, ABI3 guarantees, and wheel compilation details.
- **[SDK Validation Strategy](sdk/validation.md)**: Test isolation, virtual environment staging, and gating criteria.
- **[Workspace Layout Refactor Plan](../PLAN.md)**: High-level architectural roadmap for the monorepo workspace.
