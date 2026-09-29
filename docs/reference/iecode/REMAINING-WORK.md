# IECODE remaining work

This is the execution backlog for the unified IECODE monorepo. It is intentionally evidence-led:
an item is complete only when its exit gate has been run and its result is recorded in `PLAN.md`.
The inventory below was measured in the IECODE checkout root on 2026-09-22.

## Current baseline

| Area | Measured state | Evidence | Exit condition for the baseline |
| --- | ---: | --- | --- |
| .NET solution | 1 solution, 5 projects | `IECODE.sln`, `src/IECODE/*/*.csproj` | one restore/build/test gate remains green |
| .NET tests | 277 passing | `dotnet test src/IECODE/Core.Tests/IECODE.Core.Tests.csproj` | no regression while absorbing the next surface |
| GUI C# inventory | 522 files | `find src/IECODE/Gui -name '*.cs'` | every retained feature has a compiled shell/library owner |
| legacy GUI markers | 127 designer/resx/xaml-code-behind files | `find src/IECODE/Gui ...` | each feature is migrated or explicitly removed from the product matrix |
| Avalonia surface | 30 files | `find src/IECODE/Gui -name '*.axaml*'` | each supported tool has one Avalonia entry point |
| direct TODO/stub markers | 1 throwing export stub, 1 CLI TODO and 13 XAML TODO markers | `rg 'TODO: Implement\|NotImplementedException' src/IECODE` | zero executable stubs; disabled controls have an owner and issue entry |
| native emulation | C/C++ only; no C# | `find src/iecode-cpp/emulation`; workspace doctor | native preset builds without a managed project |
| source boundary | 0 C# outside `src/IECODE` | `find src -name '*.cs' ! -path 'src/IECODE/**'` | doctor keeps this invariant true |
| workspace roots | 23 manifests/build roots | `find . -maxdepth 3 ...` | each root is owned, deduplicated, or deliberately archived outside the checkout |

## Workstream order

The order is dependency-driven. A later surface must call the earlier library contract instead of
reimplementing it.

### 1. Freeze ownership and inventory

- Keep `src/IECODE` as the only managed C# owner and `src/iecode-cpp` as the only native C/C++ source owner.
- Move IEVR/Victory Road-specific libraries from `nie` into IECODE by measured
  slice; the first `iecode-ievr-data` crate is active, while the remaining
  runtime stays in NIE until its consumers and fixtures pass after extraction.
- Run the workspace doctor after every move and record duplicate paths, manifests and generated
  directories.
- Produce a machine-readable feature matrix mapping every retained source directory to exactly
  one owner, public API, test group and UI/CLI binding.
- Audit `aphrody-code` GitHub repositories, branches, tags, releases, GitLab mirrors and the
  Japanese/Spanish upstreams before importing code. Record URL, commit, license, language,
  feature coverage and chosen disposition; do not clone unverified or duplicate sources into
  the monorepo.

Exit gate: `bun run doctor`, duplicate scan, complete feature matrix, and a reviewed provenance
manifest with no unassigned source tree.

### 2. Finish the .NET core and FFI boundary

- Move pure save, archive, media, format, extraction and modding logic out of `Gui` into
  `IECODE.Core`; retain only view-model and adapter code in the desktop project.
- Consolidate duplicate NDS/IESE/Toolbox/SaveEditor models. One canonical type owns player,
  game-version, save-info and file-format contracts.
- Finish the player import/export/replace path through a library service and storage-provider
  abstraction. The current roster service covers recruit/dismiss; export still throws and replace
  has no file-picker binding.
- Replace the placeholder save-information preview with the game-backed model for all supported
  versions, including coins, chapter, link level and unlock flags.
- Define one versioned IECODE C ABI and make `.NET`, Bun and native consumers use it. No language
  host may duplicate codec or parser logic.
- Generate or validate bindings from the ABI; test ownership, UTF-8, buffers, errors, thread
  safety and shutdown.

Exit gate: `dotnet restore IECODE.sln --locked-mode`, full Release build, Core/GUI tests,
ABI smoke tests from .NET and Bun, and a save round-trip corpus with measured byte equality.

### 3. Complete the single Avalonia host

- Convert the retained WinForms/WPF feature groups into shell contributions, one batch at a time:
  player editor, special moves, equipment, reserve, tactics, inventory, play records, streetpass,
  map editor, toolbox, Lynx and remaining Strikers tools.
- Replace every XAML TODO with a real view, a disabled state tied to a missing capability, or a
  deliberate removal recorded in the feature matrix. Do not leave empty tabs or dead buttons.
- Preserve keyboard navigation, automation names, Fluent density, Material icon vocabulary,
  theme resources and one Avalonia application lifetime.
- Keep view-model logic testable without starting a window. GUI code calls Core services and never
  parses game files directly.
- Remove obsolete designer resources only after the corresponding feature matrix row has a
  passing replacement or an explicit removal decision.

Exit gate: no executable `NotImplementedException`, no unowned GUI feature, Avalonia startup
smoke test, UI automation assertions for every shell command, and `just ecrans` where available.

### 4. Converge Rust into `iecode-core` and `iecode-ffi`

- Inventory every Rust crate under the IECODE and related workspaces; classify it as portable
  IECODE, IEVR/Victory Road, duplicate, generated, or external dependency.
- Merge portable formats, media, archive, RE, emulation and task logic behind one `iecode-core`
  facade. Keep capability modules feature-gated and avoid a second public implementation.
- Merge the stable C ABI into `iecode-ffi`; expose the same ownership and error model to Bun,
  .NET and native callers.
- Keep `nie`/`niers` for IEVR/Victory Road-specific ownership and the Rust CLI binding only. Do
  not rename an existing `nie` route or public key as part of an unrelated migration.
- Update Cargo manifests and lockfile together, then run the three target checks and deny gates.

Exit gate: one documented Rust dependency graph, `cargo check --workspace --tests --locked`,
clippy with `-D warnings` for touched crates, `cargo deny check advisories bans licenses sources`,
FFI ABI tests and no duplicate portable crate owner.

### 5. Native C/C++ and melonDS integration

- Keep `src/iecode-cpp` for all native IECODE code, including the `emulation/melonds` subsystem;
  do not move C++ into the C# project or add a C# project to the emulator subsystem.
- Remove or vendor only explicitly approved third-party code; every retained external subtree
  must have a license and update policy. No hidden source copy may exist in `src/IECODE`.
- Route shared functionality through the IECODE C ABI or a deliberate C++ adapter, not process
  invocation and not duplicate parsers.
- Keep `CMakePresets.json` environment-driven (`VCPKG_ROOT` from the invoking environment), with
  one vcpkg manifest and one native verification target.
- Add native smoke tests for melonDS launch/configuration and the IECODE C ABI without committing
  ROMs, copyrighted dumps or generated build output.

Exit gate: `cmake --preset unified`, `cmake --build --preset unified --parallel 2`, native test
counts, and the source-boundary doctor.

### 6. Bun, Python and package publication

- Keep one Bun workspace and lockfile, with `@iecode/*` names and no dead package or service.
- Make Bun a thin FFI/API/CLI consumer; remove duplicate media, URL, video and emulator logic.
- Keep one uv workspace and lockfile, Ruff checks and `uv run` entry points; migrate only useful
  Python extraction/modding tooling and record its owner.
- Keep Turborepo as task graph only. `cargo`, `dotnet`, `cmake` and `uv` remain authoritative for
  their languages.
- Publish only after package metadata, exports, license, provenance, ABI compatibility and
  generated declarations are verified. Use crate.io/npm/Bun publication as release outputs, not
  as source ownership.

Exit gate: `bun run doctor`, `bun run typecheck`, `bun run test`, `bun run check:python`, package
dry-runs, FFI smoke tests and a clean isolated release staging directory.

### 7. Media, emulation and legal-content boundaries

- Keep media URLs, video metadata, readers, manga/episode/movie indexing and emulator adapters in
  one IECODE capability graph, with no duplicate package between IECODE and `nie`.
- Support only user-provided/legal game data; never commit ROMs, dumps, copyrighted video or bulk
  generated assets. Test fixtures must be synthetic or explicitly tracked legal fixtures.
- For DS/3DS/Wii/mobile adapters, document the closest emulator/library link, supported version,
  extraction path and modding boundary. Do not clone arbitrary emulator repositories into the
  source tree merely because they are popular.
- Treat fan mods and game variants as metadata/import formats; do not redistribute copyrighted
  content. Document how a user can supply their own dump/save and how to create a mod.

Exit gate: capability matrix, legal-content audit, synthetic fixture tests, and one owner per
media/emulation operation.

### 8. Release and repository hygiene

- Keep `scripts/release-all.ts` as the only release orchestrator and preserve its fixed phase
  order. Do not add a competing script.
- Keep generated `bin`, `obj`, `node_modules`, caches, vcpkg installations, dumps and backups out
  of Git. No `legacy`, `backup`, temporary mirror or incomplete duplicate directory may remain in
  the canonical source tree.
- Update `PLAN.md` after every durable architectural decision with command, source path, host and
  measurement date for volatile numbers.
- Commit coherent batches, run `git diff --check`, push only the verified branch, and record the
  exact commit in the release report.

Exit gate: clean `git status`, all language gates, native gate when applicable, provenance and
license report, and a staging release with meaningful payload checks.

## Immediate next batch

1. Add the player import/export/replace service and storage messages; remove the remaining
   `MainViewModel` export stub.
2. Convert the first reserve/player tabs into a real Avalonia shell contribution and add view-model
   tests for recruit, dismiss and replace.
3. Record the complete GUI feature matrix and mark each of the 127 legacy designer/resource files
   as migrated, retained as data, or removed.
4. Run the full language/native gates and append measured counts to `PLAN.md`.

No item above is considered complete from a plan edit alone; the source tree and its gates remain
the authority.
