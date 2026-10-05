<!-- SPDX-License-Identifier: MIT -->
# Optional native tooling provider

`yolo-tooling` groups the existing N2B and Oxc implementations in one optional
shared library, without duplicating them or adding either engine to the default
core/runtime build. It exports group ABI 1, N2B ABI 2 and Oxc ABI 1 through
[yolo-tooling.h](include/yolo-tooling.h). Component symbols and allocators retain
their existing names and ownership contracts.

Build this C ABI artifact through the factory and the serialized Cargo owner,
with an unwind profile. Abort profiles cannot preserve the engines' panic-to-JSON
error boundary. No precompiled artifact is implied by the source files.

The Bun client is `@aphrody/runtime-sdk/tooling`; Core reexports that same owner
through `@aphrody/yolo-core/compiler/native`. Importing it does not load a library.
Its SDK loader opens a selected `YOLO_TOOLING_LIB`, one embedded Bun asset or installed
`libyolo_tooling` lazily and checks all three ABI versions before calling an
engine. Returned strings are copied and released by their original allocator,
including failed JSON decoding. Closing the client is terminal and unloads its
owned handle. Calls are synchronous within a JavaScript isolate; native N2B
owns file parallelism and its process-wide scan budget across workers.

N2B accepts explicit jobs 1..6 and mode/check/fix/aggressive, ignore and dry_run.
The no-options entrypoint is a read-only check. Fix/aggressive can write files
unless dry_run is true. The provider starts no migration subprocess. Oxc AST
analysis stays in the parser API; ordinary transpilation/bundling use Bun.

`analyzeModule(source, filename)` uses Oxc's official module record, retaining
physical import/reexport requests, type exports, wildcard exports and source order.
`parseProgram` returns official ESTree JSON with UTF-16 spans. BigInt and RegExp
literal values remain JSON null, with their `bigint`/`regex` metadata intact;
the Core `ESTreeProgram` type reflects this representation.

Qualification distinguishes transport/ABI fixtures and actual Rust engine
execution. Fixtures do not qualify the native
tooling artifact, release provenance, installation or Bun builtin absorption.
