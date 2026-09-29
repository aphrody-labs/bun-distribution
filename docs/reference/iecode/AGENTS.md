# IECODE agent instructions

`PLAN.md` is the execution ledger. Read it before editing; durable history and the remaining
work matrix live in `docs/`. This file is the single repository-level agent contract. There are
no nested agent instruction files in the canonical IECODE tree.

## Ownership

- Rust is the default owner for new portable emulator logic, scheduling,
  device models, tests, WASM and WebGPU adapters. Reuse compatible Aphrody
  crates and conventions before adding a new dependency or C/C++ implementation.
- C/C++ keeps upstream native emulator code and target-side homebrew libraries;
  C is the stable cross-language ABI. C# owns the existing Windows, launcher,
  save and modding surfaces; Python owns extraction, scripting and data work.
- `src/IECODE/` is the only managed C# owner and contains the Core, CLI, GUI and FFI projects.
- `src/iecode-cpp/` is the only C/C++ owner. Its `emulation/melonds` subsystem retains the
  upstream GPL notices and may not contain a C# project or managed source.
- `src/iecode-cpp/` owns portable native IECODE code; shared behavior crosses the explicit FFI
  boundary instead of being copied into C# or Bun.
- `crates/`, `packages/`, `apps/` and Python members keep their existing language owners until
  an extraction is measured and recorded in `PLAN.md`.
- The root Cargo workspace, Bun workspace, uv workspace, .NET solution and CMake
  superbuild are the sole IECODE project entry points for their languages.
  `engine/`, `emulators/` and `libraries/` preserve pinned Rust fork source;
  new shared APIs land in `iecode-*` members only after measured extraction.
- IECODE is absorbing IEVR/Victory Road game libraries and bindings from the
  transitional `nie` checkout. The single migration
  ledger is `../src/nie/PLAN.md` from this checkout's personal-directory location.

## Working rules

- Preserve unrelated working-tree changes. Inspect `git status --short` before editing and stage
  only the requested paths.
- Keep identifiers, paths, schemas, APIs, comments and technical documentation in English.
- Put reusable behavior in a library first; CLI, GUI, Bun and FFI are thin bindings.
- Use repository package managers: `cargo`, `bun`, `uv`, `dotnet`, CMake and vcpkg. Do not add a
  second orchestrator or hard-code checkout paths.
- Never commit ROMs, dumps, copyrighted media, generated build directories, caches, secrets or
  private endpoints. Do not use force reset, force push or `pkill -f`.
- Deployment and releases belong to Infra's `@aphrody/workspace` in the new
  Aphrody monorepo. IECODE's local gate binding resolves that workspace through
  `APHRODY_ROOT` or its sibling checkout; it does not call the old Infra CLI.
  IECODE exposes thin `bun run` gate scripts only. Run the
  complete release gates (`bun run check:all`, `bun run release:check`) before any release.

## Gates

Run the narrowest relevant gate and report counts:

```text
bun run doctor
bun run typecheck
bun run test
bun run check:rust
bun run check:python
dotnet restore IECODE.sln --locked-mode
dotnet build IECODE.sln --configuration Release --no-restore
dotnet test src/IECODE/Core.Tests/IECODE.Core.Tests.csproj --configuration Release --no-restore
cmake --preset unified
cmake --build --preset unified --parallel 2
git diff --check
```

Build output under `src/**/bin`, `src/**/obj`, `__pycache__`, `node_modules` and the native build
directory is disposable and must be absent from the committed tree. Update `PLAN.md` with the
measured result and date after each architectural batch.

## Automatisation transversale

`bun run doctor` et `bun run check:licenses` délèguent leurs contrôles au nouveau paquet `@aphrody/workspace` via `scripts/aphrody-ops.ts`. Conserver cette entrée locale lors de toute évolution du module central.

Les gates Python s’exécutent via `bun run lint:python` et `bun run test:python`,
qui délèguent à `aphrody-ops python-quality`.
