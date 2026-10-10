<!-- SPDX-License-Identifier: Apache-2.0 -->
# Python, JavaScript and Rust in the Bun fork

Owner directives, 2026-10-09: Bun owns the complete native Python toolchain,
including vu, uv, Ruff, PyO3, interpreter hosting, parsers, Cython and Jupyter
integration. Aphrody retains Python application/SDK sources and product behavior.
This supersedes the separate-runtime ownership in [the earlier vu plan](../vu/PLAN.md).
Product RAG algorithms remain with Aphrody; their native Python adapter belongs
to Bun. Existing installed runtimes remain available until replacement qualifies.

The owner also directs removal of Yolo/vu runtime indirection and bottlenecks:
call Bun directly, merge useful existing uv/Ruff/PyO3 logic into its capability
owner, and retire duplicate launchers after behavior and rollback qualification.
Lazy packaging remains required; source consolidation alone is not evidence of
lower latency or memory use.

The fork is selected by `APHRODY_BUN_CHECKOUT` or explicit workspace configuration.
The canonical specification is `docs/aphrody/LAYERS.md` (not in repo) in that checkout.
Native Windows, qualified SSH factories and other native targets retain their
own build allocation, authentication and installation permissions.

## Runtime and package ownership

The Bun binary keeps only the necessary lazy dispatch. CPython, uv/Ruff graphs,
PyO3 adapters, Cython, CUDA/PyTorch and Jupyter are external components owned
by the fork. Importing ordinary JavaScript must not initialize Python, touch its
environment, load CUDA or install packages. No vendor tree, model, credential,
provider transcript or persistent environment is migrated into Git.

Reuse the existing native host, runtime SDK, vu implementation, uv resolver,
Ruff parser and first-party Workspace/Infra orchestration. Multiple parsers
are justified only by distinct responsibilities: CPython for execution,
tree-sitter for incremental syntax, Ruff for its existing semantic/lint pipeline.
An interpreter alternative must not silently replace CPython extension behavior.

## Qualification matrix

| Capability | Required evidence before activation | Current qualified scope |
| --- | --- | --- |
| PyO3 SDK ownership | pinned native source, locked wheel, installed imports, native results | Bun adapter transferred; Windows Aphrody and Yolo wheels pass |
| Shared CPython host | one library, ownership/attach lifecycle, exception and destruction contracts | external host passes Windows native lifecycle roundtrip |
| Complete vu/uv/Ruff | real source/locks/provenance, full CLI and rollback, no duplicate implementation | VPS source transfer and gates in progress; old installed artifact preserved |
| `bun file.py` / `bun run file.py` | real changed Bun binary; argv, cwd, imports, encodings, stdin, traceback, exit code, venv | pending native dispatch and shared-host CLI API |
| Python libraries | project environment/resolver consistency; installed native extensions, NumPy/PyTorch CPU contracts | pending full environment qualification |
| CUDA / PyCUDA / PyTorch GPU | real qualified hardware, toolkit/driver compatibility, tensor result and synchronization tests | no GPU qualification claimed |
| Python parsers | immutable grammar/compiler pins; syntax versions, error spans, incremental edits | reuse inventory and integration pending |
| Cython | build/import a real extension; toolchain/ABI, dependency and rebuild behavior | pending |
| Jupyter | real kernels, protocol/lifecycle, notebook outputs/errors, Python/JS cells and shared state | pending |
| Python ↔ JS objects | shared native object identity, mutation, exceptions, lifetime/GC and thread safety | pending; JSON copies do not qualify shared memory |
| Python ↔ JS buffers | zero-copy writable/read-only views, slicing, bounds, retention and release | pending |
| Rust imports/exports | real library through existing Bun FFI; Python/JS callbacks and errors, panic/unwind isolation | existing runtime SDK reused; cross-language roundtrip pending |
| Mixed-language files | explicit grammar, source maps, imports, cells/blocks ordering, errors, editor support | format preference requested; independent bridges continue |
| Unified install/compile | same project environment, locked uv/Bun resolution, native build hooks, no competing resolver | pending consumer integration |
| Performance | comparable Bun size/startup/RSS before and after any binary change; package load costs separate | this external-host transfer adds no Bun engine dependency; no performance gain claimed |

## Memory and execution contracts

JavaScript and Python run in the same process and share native object ownership
through the existing ABI. A proxy may represent another language's object; it
must preserve identity and mutation rather than silently serialize a snapshot.
Shared buffers need explicit pinning across both collectors, bounds checks,
read-only flags, and an owner that releases the allocation only after both
languages release it. Resizing or finalizing a borrowed allocation must be refused.

Specify GIL/free-threaded behavior, the Bun event-loop thread, reentrant calls,
callback lifetime, cancellation and exception translation before exposing an
API. Rust callbacks must never unwind across C; JavaScript/Python exceptions
must remain observable with useful source locations. Remote code receives no
implicit privileged host access. Avoid pretending the two collectors are one GC.

Native CLI execution uses the shared library's full CPython entry point,
preserving executable/prefix selection, argv and process status. The evaluator
API alone cannot qualify arbitrary Python scripts, `SystemExit`, `-m`, or venvs.
Installation, source transfer, native builds and live activation are separate
evidence levels. Each completed owned batch gets a receipt and scoped gates.

See [the bounded queue](TODO.md).
