# IECODE

IECODE is the unified portable toolkit for Inazuma Eleven data, media, formats, modding and
developer workflows. It is one monorepo with one canonical .NET solution and shared Rust, Bun,
C/C++ and Python workspaces.

The canonical checkout is outside the sibling Aphrody source workspace.
Each language has one IECODE-owned entry point: `Cargo.toml` for Rust,
`IECODE.sln` for C#, `CMakeLists.txt` for C/C++, `package.json` for Bun and
`pyproject.toml` for Python. Imported emulator and engine source lives in
`emulators/` and `engine/`; it does not create a second IECODE release gate.

## License and provenance

The native IECODE distribution is open source under the GPL family. The C/C++ tree is one
source owner at `src/iecode-cpp`; its `emulation/melonds` subsystem preserves the full upstream
license texts and notices for melonDS, Dolphin, Teakra, FatFs, tiny-AES-c, libslirp and blip-buf.
The exact component mapping and redistribution rules are in [LICENSES.md](../../reference/iecode/LICENSES.md) and
[THIRD_PARTY.md](../../reference/iecode/THIRD_PARTY.md). Do not relabel the combined emulator artifact Apache-2.0.
The imported IEVR game-domain Rust source is private and non-publishable under
the separate NIE commercial rights boundary; it is not covered by the native
GPL or IECODE's permissive component notices. See
[IEVR data migration](../../reference/iecode/IEVR-DATA-MIGRATION.md).

| Project | Responsibility |
| --- | --- |
| `IECODE.Core` | reusable formats, archives, media, save and modding logic |
| `IECODE.Cli` | command-line host |
| `IECODE.Gui` | single Avalonia desktop host with Fluent/Material design |
| `IECODE.Ffi` | native interop boundary |
| `IECODE.Core.Tests` | regression tests |

The GUI owns one application lifetime. Its shell registry connects menus, toolbars, keyboard
gestures and plugin views. The NDS viewer, toolbox decoder and IEVR tools are integrated surfaces,
not separate applications.

```sh
dotnet restore IECODE.sln --locked-mode
dotnet build IECODE.sln --configuration Release --no-restore
dotnet test src/IECODE/Core.Tests/IECODE.Core.Tests.csproj --configuration Release --no-restore
bun run doctor
```

See [PLAN.md](../../plans/iecode/PLAN.md), [docs/ARCHITECTURE.md](../../architecture/iecode/ARCHITECTURE.md) and
[docs/gui/README.md](./gui/README.md). The complete remaining-work matrix is in
[docs/REMAINING-WORK.md](../../reference/iecode/REMAINING-WORK.md). Imported Rust engine,
emulator and dependency source, with exact revisions and legal/build gaps,
is recorded in [docs/FORK-INTEGRATION.md](../../reference/iecode/FORK-INTEGRATION.md).
The per-language names, directories, ownership and shared-logic rules are in
[docs/MONOREPO-CONVENTIONS.md](../../reference/iecode/MONOREPO-CONVENTIONS.md).

## Automatisation transversale

`bun run doctor` et `bun run check:licenses` délèguent leurs contrôles au
`@aphrody/workspace` du nouveau monorepo Aphrody. `APHRODY_ROOT` peut
surcharger le checkout frère par défaut.

## Automatisation Python

`bun run lint:python` et `bun run test:python` délèguent les gates Python à
`aphrody-ops python-quality` depuis le nouveau monorepo Aphrody.
