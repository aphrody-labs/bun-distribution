# IECODE C# reference toolkit

This is the unified IECODE workspace. Its C#, C/C++, Python, Bun and Rust surfaces share one
source layout and one FFI boundary. IEVR/Victory Road-specific runtime ownership remains in the
sibling `nie` workspace; portable format, media, extraction and binding code belongs here.

## Scope

- `src/IECODE/Core`: the single .NET 10 format, extraction and conversion core.
- `src/IECODE/Cli`: the single .NET binding for the shared capability core.
- `src/IECODE/Gui`: the single Avalonia GUI host for the integrated IESE and ndsSharp surfaces.
- `src/IECODE/Ffi`: the native IECODE FFI bridge.
- `crates/`, `packages/`, `apps/`: Rust core/FFI, Bun bindings and the Rust CLI.
- `IECODE.sln`, `Cargo.toml`, `package.json`, `pyproject.toml`: unified build entry points.

This repository contains no game dumps or generated VFS data.

See [Development environment](../../reference/iecode/DEVELOPMENT-ENVIRONMENT.md) for the validated
WSL/Windows toolchain, persistent caches, shell variables, and native gates.
