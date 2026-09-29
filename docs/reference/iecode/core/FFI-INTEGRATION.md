# IECODE core and FFI integration

This records the inputs used to make `iecode-core` the single logic owner and
`iecode-ffi` the single native boundary.

The complete Git/fork/branch/tag/release/PR inventory is maintained in
[`docs/history/APHRODY-AUDIT.md`](../../../research/iecode/history/APHRODY-AUDIT.md); this document
only records the technical consequences for the ABI.

## Evidence inspected

| Surface | Evidence | Decision |
| --- | --- | --- |
| `aphrody-code/node-api-dotnet` | `main` at `0327161bb2b9409cd2fe6ccdf926eb7f3245b0c0`; 81 Node API files, 11 host files, 9 generator files | Consume the official Node API contract through NuGet; do not copy its implementation. |
| Node API packages | `Microsoft.JavaScript.NodeApi` and `.DotNetHost` latest queried 2026-09-22: `0.9.29-gef9453cdcf` | `IECODE.Ffi` targets .NET 10 and uses the current package line. |
| Winclean | `705a57611391`, `ef1cdbdbc3b6`, `33a1dc9981aa`, `5db98b27b33c`, `a1ac2b2ca965`, `64fec35643c8`, `39f30fe622cd` | Use a flat C ABI, schema boundary, AOT-safe imports, and environment-based loading. |
| `aphrody-code/iecode-cpp` | `7d8b1d67e2de`, `2e8f669e32ea`; audit: 337 implementation files and 259 headers | Keep C++ as a native backend; it does not own the cross-language contract. |

The upstream Node API project is [microsoft/node-api-dotnet](https://github.com/microsoft/node-api-dotnet).

## Ownership graph

```text
iecode-core (Rust facade)
        |
        +-- iecode-emu / geom / re / sql / tasks / video
        |
        +-- iecode-ffi (flat C ABI, cdylib + rlib)
                 |-- packages/iecode-ffi (Bun bun:ffi)
                 |-- src/IECODE/Ffi (IECODE.Ffi, .NET 10 + Node API host)
                 +-- C/C++ and other native consumers
```

The leaf crates remain testable while callers migrate to the facade. New
cross-surface capabilities belong in `iecode-core`, not in a CLI or adapter.

## ABI rules

- Only fixed C scalars, pointers and explicit lengths cross the boundary.
- Rust allocations use `IecodeBytes { ptr, len, cap }` and
  `iecode_bytes_free_fields`; no caller guesses ownership.
- Symbols use the `iecode_` prefix and schema `iecode.ffi/v1`.
- Bun resolves `IECODE_FFI_LIBRARY` or the platform loader name; no checkout path is compiled in.
- .NET uses source-generated `LibraryImport`; Node API remains the official host layer.
- Native code is loaded directly: no subprocess, CLI invocation or duplicate runtime.

The first vertical slice exposes the pure, serializable emulator registry. It is
covered by Rust ABI tests and Bun contract tests; larger capabilities join the
same boundary only after their ownership and allocation rules are specified.
