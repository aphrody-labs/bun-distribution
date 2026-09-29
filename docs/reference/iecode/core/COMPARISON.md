# Core comparison

Measured in the IECODE checkout on 2026-09-22. Counts are inventory measurements, not quality
ratings.

## Rust libraries already absorbed

| Current package | Measured role | Core decision |
| --- | --- | --- |
| `iecode-emu` | Emulator capability metadata and ownership registry | Move to `core::emu`; keep metadata pure and never launch a process from the library. |
| `iecode-geom` | `Vec2`/`Vec3` POD math, optional `no_std` | Move to `core::geometry`; preserve the `no_std` feature. |
| `iecode-re` | Generic PE/ELF/Mach-O triage, strings, hashing, x86 disassembly | Move to `core::re`; it is portable and has no IEVR dependency. |
| `iecode-sql` | SQLite/PostgreSQL read-only boundary and migrations | Move to `core::sql` behind a feature; keep database drivers out of the default core. |
| `iecode-tasks` | Cancellable/pausable host jobs and progress | Move to `core::tasks` behind `host`; do not pull Tokio into no-std or WASM consumers. |
| `iecode-video` | RGBA frame validation and video contracts | Move to `core::video`; keep external encoders as adapters. |
| `iecode-cli` | Clap binding and process entry point | Exclude from the crate; depend on `iecode-core`. |

The current Rust workspace contains 10 Rust source files across these libraries (excluding the
CLI). Their small size makes consolidation feasible, but their feature and dependency boundaries
must be retained so geometry can stay lightweight and browser builds do not acquire SQL or host
drivers.

## C++ `iecode_core`

The C++ tree contains 337 C/C++ implementation files and 259 headers in the inspected source
surface. `src/iecode-cpp/src/CMakeLists.txt` builds a static `iecode_core`, but its source glob
sits beside separate `cli`, `tests`, `decomp`, `engine` and `game` trees. The target links fmt,
spdlog, JSON, tree-sitter, DirectXTex, WebP, zlib/zstd, OpenSSL, GLM, Assimp, bgfx and sol2,
with optional PostgreSQL and Rizin. This is a broad native toolkit, not a pure core.

### Eligible for the canonical core contract

- bounded binary I/O, compression and crypto;
- format detection and pure Level-5/Criware readers;
- deterministic archive and asset conversion primitives;
- VFS path/data contracts with no process, network or database side effects;
- geometry/math value types where Rust has no existing owner.

### Must remain an adapter or be ported before absorption

- `apps/iecode-cli` and every `main()`;
- tests, benchmarks and executable export tools;
- game/runtime/render/Lua services and IEVR-specific game data;
- GameBanana/update/network/database services;
- `third_party/`: replace with vcpkg/system packages or a separately governed external package;
  do not copy it into `iecode-core`.

The C++ implementation should first expose a narrow `extern "C"` ABI around eligible operations.
Rust calls that ABI only under an opt-in feature; the default implementation is Rust. This keeps
the C++ code useful for parity and performance without making C++ layout part of the public API.

## C# `IECODE.Core`

The project contains 172 C# files. Its namespaces include format/compression/crypto, archives,
CDN, converters, dump, graphics, Lua, search, Steam, runtime, game data and `Viola.Core`.
Dependencies include MoonSharp, SharpGLTF, ImageSharp, hashing/toolkit packages, BCnEncoder,
LZ4, EF Core SQLite and SteamKit2.

### Eligible for the canonical core contract

- pure parsers/serializers and bounded compression/crypto;
- format-independent data models and validation;
- deterministic conversion operations with explicit input/output buffers;
- test fixtures that can be expressed as byte-for-byte or structured parity cases.

### Must remain a .NET adapter or separate product surface

- `IECODE.CLI` and `System.CommandLine` handlers;
- Steam/content delivery, Windows search, memory/runtime integration and network clients;
- IEVR game tables, game state, save/editor UI and launcher behavior;
- `Viola` operations until each function is isolated behind a typed contract.

.NET Native AOT can export only methods explicitly marked with `UnmanagedCallersOnly` and a
non-empty entry point; therefore the bridge must be a small export assembly, not the whole object
model. The managed implementation remains testable independently.

## Other package surfaces

| Surface | Current owner | Core treatment |
| --- | --- | --- |
| Python/uv | Four workspace members: `Buscador-Inazuma`, `IEStrikers`, `InazumaElevenGoMapenv`, `inz_cond` | Keep research/tool adapters in uv; port only pure, measured algorithms into Rust with parity fixtures. |
| Bun | No IECODE Bun wrapper is staged in the Aphrody workspace | Reintroduce a generated FFI consumer only after validating the shared schema, source license and ABI end to end. |
| C# applications | IESE, mod manager, ndsSharp, editors and tools | Applications stay applications; they call `IECODE.Core`/FFI and do not become core modules. |
| C++ melonDS/IEStrikers | Emulator or game-specific source | Keep separate from portable IECODE core and expose only measured capability contracts. |

## Comparison outcome

Rust is the only suitable canonical core owner because it already has the portable absorbed
libraries, one lockfile, feature gates, workspace lints, JSON contracts and direct CLI binding.
C++ and C# are valuable implementation sources and optional native backends, but neither has a
single dependency-light, cross-platform core boundary today. A physical merge without extraction
would import their CLIs, process/network side effects, game-specific state and third-party trees
into every Rust consumer.
