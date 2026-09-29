# C# API mapping for iecode-emu

Audit scope: the C# repositories under `src/` that expose save, memory/game-data, or modding
behavior. This document is a boundary contract for an `iecode-emu` consumer; it is not a
launcher contract and it does not authorize a process adapter.

## Boundary rules

`iecode-emu` may consume a surface only through one of these routes:

1. a Rust implementation migrated from the measured behavior;
2. a C ABI exported by a native Rust library and called through FFI; or
3. an existing native DLL imported explicitly by the Rust side.

The boundary must not expose managed `Stream`, `Dictionary`, `List`, tuples, WinForms/WPF
dialogs, callbacks, `System.Type`, or process handles. The normalized ABI uses owned byte buffers,
UTF-8 strings, fixed-width integers, opaque handles, and explicit error codes. Rust owns every
allocation returned across the boundary and provides the matching free function.

The following are deliberately outside the mapping: game discovery, Steam integration, game
launch, `Process`, `ProcessStartInfo`, and the Viola CLI integration. They are UI/process
concerns, not `iecode-emu` capabilities.

## Normalized `iecode-emu` operations

| Operation | Input | Output | Preferred implementation |
| --- | --- | --- | --- |
| `save_open` | immutable save bytes | opaque save handle + detected game/version | Rust migration of the format parser |
| `save_read_model` | save handle | versioned flat model buffer | Rust migration; use an explicit schema version |
| `save_write_model` | save handle + model buffer | status/error | Rust migration |
| `save_export` | save handle + encrypted flag | owned save bytes | Rust migration |
| `save_player_file_read` | format id + bytes | player model buffer | Rust migration of INZ4/INZ5/INZ6 |
| `save_player_file_write` | format id + player model buffer | owned bytes | Rust migration |
| `memory_read` | image/archive handle + normalized path/offset/length | owned bytes | Rust migration of the binary/VFS layer |
| `memory_write` | image/archive handle + path/offset + bytes | status/error | Rust migration |
| `memory_commit` | image/archive handle | owned archive/image bytes | Rust migration |
| `mod_scan` | mods root + optional profile buffer | flat mod-entry buffer | Rust migration |
| `mod_profile_read` | profile name or bytes | profile buffer | Rust migration |
| `mod_profile_write` | profile buffer | status/error | Rust migration |
| `mod_conflicts` | flat mod-entry buffer | conflict buffer | Rust migration |
| `mod_merge` | cpk-list bytes + mod trees | merged output tree/archive | Rust implementation or imported native DLL; never a subprocess |

The C# names below are evidence and migration inputs, not names that should be exported as the
ABI.

## Surface mapping

### IESE — modern save editor

Source: `IESE/IESEViewModel/DataHandler.cs`, `IESE/IESEViewModel/InazumaEleven/Games/IGame.cs`,
and `IGameMixiMax.cs`.

| Existing public API | Mapping | Notes |
| --- | --- | --- |
| `DataHandler.Open(Stream)` | `save_open(bytes)` | Replace `Stream` with `(ptr, len)`; preserve header detection and decryption behavior. |
| `DataHandler.SaveAsync(IGame, bool)` | `save_export(handle, encrypted)` | Replace `Task<byte[]>` with caller-owned output buffer and status/error code. |
| `IGame` model dictionaries and lists | `save_read_model` / `save_write_model` | Flatten `Players`, `Moves`, `Avatars`, `Items`, `Equipments`, `Reserve`, `Inventory`, `SaveInfo`, and `Teams`; do not expose CLR collections. |
| `IGame.RecruitPlayer`, `ChangePlayer`, `Training`, `UpdateInventory` | save mutation operations | Use player/team IDs and scalar fields in a versioned request buffer; do not pass `Player` objects across FFI. |
| `IGame.Save`, `SaveSaveInfo`, `SaveTactics`, `SaveInventory`, `SavePlayers` | `save_write_model` + `save_export` | The four writer methods are internal format phases, not separate public `iecode-emu` operations. |
| `IGameMixiMax.GetPlayRecords`, `Auras`, `SavePlayRecords` | extension fields of the save model | Expose only when the detected game version supports them. |

This is the best source for the save migration because it already separates UI from
`IESEViewModel`; the view models and `Messages/*` remain UI-only.

### InazumaElevenSaveEditor — historical save editor

Source: `InazumaElevenSaveEditor/InazumaElevenSaveEditor/InazumaEleven/Saves/ISave.cs`,
`Saves/IE/IE.cs`, `Games/IGame.cs`, and `INZ/INZ4.cs`, `INZ5.cs`, `INZ6.cs`.

| Existing public API | Mapping | Disposition |
| --- | --- | --- |
| `IE.Open(BinaryDataReader)` | `save_open(bytes)` | Keep the format detection logic, replace the reader with a Rust byte cursor. |
| `IE.Save(OpenFileDialog)` | `save_export` | UI-bound and rejected as an ABI; the output path belongs to the caller. |
| `IGame` game/player/team methods | same normalized save operations as IESE | Migrate behavior, not the managed object graph. |
| `INZ4/5/6.NewPlayer(path)` | `save_player_file_read` | Replace path I/O with input bytes and a format discriminator. |
| `INZ4/5/6.NewFile(player)` | `save_player_file_write` | Return bytes; the caller decides where to persist them. |
| `ICompression` / `XORShift` | private format codec in Rust | Preserve byte-level behavior and test against fixtures; do not export a C# compression object. |

The project is historical and UI-coupled. It should not be made a dependency of `iecode-emu`.

### Inazuma-Eleven-Toolbox — historical save/crypto helpers

Source: `Inazuma-Eleven-Toolbox/Inazuma-Eleven-Toolbox/Logic/Cryptography.cs` and
`Forms/Save-Editor.cs`.

| Existing public API | Mapping | Disposition |
| --- | --- | --- |
| `NDSIE3.EncryptSave(byte[], UInt32)` | save codec stage | Migrate the algorithm to Rust and expose it only as part of `save_open`/`save_export`. |
| `NDSIE3.DecryptSave(byte[], UInt32)` | save codec stage | Same; define buffer length and ownership explicitly. |
| `SetMoveLevels(NumericUpDown, ...)` | player mutation in `save_write_model` | Reject the WinForms signature; map the values to scalar model fields. |
| `SetReadOnly(NumericUpDown, ComboBox)` | none | UI-only; no `iecode-emu` mapping. |

### Lynx — save and game-data editor

Source: `Lynx/Lynx/InazumaEleven/Save/Games/IGame.cs`,
`Lynx/Lynx/InazumaEleven/Save/Saves/ISave.cs`, and
`Lynx/Lynx/InazumaEleven/Games/Game.cs`.

| Existing public API | Mapping | Disposition |
| --- | --- | --- |
| `Save.Games.IGame` (`RecruitPlayer`, `ChangePlayer`, `NewMixiMax`, `Training`, `Save`) | normalized save operations | Strong candidate for Rust migration; its dictionaries and mutable objects must become flat handles/models. |
| `Save.Saves.IE.Open(BinaryDataReader, ...)` | `save_open(bytes)` | Remove database dictionaries and use a versioned model request. |
| `Save.Saves.IE.Save(OpenFileDialog)` | `save_export` | UI-bound; rejected at the boundary. |
| `Games.Game.GetFile(string)` / `Files` | `memory_read` | Normalize virtual paths and return bytes, not `SubMemoryStream` or `GameFile`. |
| `Games.Game.AddFile`, archive fields (`ARC0`, `XPCK`) and `Save()` | `memory_write` / `memory_commit` | Migrate the archive implementation or import a native DLL; `StudioElevenLib` managed types do not cross FFI. |
| `Game.GetEmptyObject<T>()` and `Type*` properties | none | Reflection/type-valued APIs are not ABI-safe; replace with typed format operations. |

Lynx is the broadest memory/game-data surface, but the audit found virtual archive/file editing,
not a process-memory API. The manifest must therefore call this `game_data`/`virtual_memory`,
not `process_memory`.

### InazumaElevenMapEventEditor — binary memory/VFS editor

Source: `InazumaElevenMapEventEditor/InazumaElevenGoMapEventEditor/Tool/VirtualDirectory.cs`,
`Tool/SubMemoryStream.cs`, `Tools/BinaryDataReader.cs`, and `Tools/BinaryDataWriter.cs`.

| Existing public API | Mapping | Disposition |
| --- | --- | --- |
| `VirtualDirectory.GetFileFromFullPath` | `memory_read(path)` | Return an owned byte buffer. |
| `VirtualDirectory.AddFile`, `AddFolder` | `memory_write(path, bytes)` | Validate normalized paths and reject traversal. |
| `VirtualDirectory.GetAllFiles`, `GetSize` | `memory_read` metadata | Return a flat list of path/offset/length records. |
| `VirtualDirectory.Reorganize`, `SortAlphabetically` | deterministic archive normalization | Rust migration helper; not a UI API. |
| `SubMemoryStream.Read` and `ByteContent` | lazy byte-range read | Replace with explicit `(offset, length)` input. |
| `BinaryDataReader.GetSection` / `BinaryDataWriter.Write` | buffer primitives | Internal implementation helpers; do not expose managed reader/writer handles. |

This is an in-memory binary/VFS editor, not a launcher or process-memory adapter.

### IEVR_Mod_Manager — pure mod data versus rejected process integration

Source: `IEVR_Mod_Manager/Managers/ModManager.cs`, `ProfileManager.cs`, `ConfigManager.cs`,
`Helpers/SteamHelper.cs`, and `Managers/ViolaIntegration.cs`.

| Existing public API | Mapping | Disposition |
| --- | --- | --- |
| `ModManager.ScanMods` | `mod_scan` | Migrate directory scanning and metadata parsing to a Rust library; return flat entries. |
| `ModManager.GetEnabledMods` | `mod_scan` result filter | Keep as a pure data operation over the normalized entry buffer. |
| `ModManager.DetectPacksModifiers` | `mod_conflicts` | Migrate path classification and conflict reporting. |
| `ProfileManager.GetAllProfiles`, `LoadProfile`, `SaveProfile`, `DeleteProfile` | profile operations | Migrate JSON schema and safe-name rules; use bytes/records instead of app-global paths. |
| `ConfigManager.Load/Save` | optional host configuration | Not a game capability; keep outside the core `iecode-emu` API unless a host explicitly needs it. |
| `ViolaIntegration.MergeModsAsync` | `mod_merge` | The current implementation is rejected because it depends on `Process`/`ProcessStartInfo` and an external executable. Replace with Rust or import a native DLL exposing a merge ABI. |
| `SteamHelper.DetectGamePath` and `MainWindow.PlayButton_Click` | none | Launcher/discovery behavior is explicitly excluded. |

`mod_scan`, profiles, and conflict analysis are suitable for migration. Applying/merging mods is
not considered mapped until the merge algorithm exists as Rust or a native DLL import.

## Implementation order

1. Migrate the shared Level-5 cursor, compression, save header detection, and INZ codecs to Rust.
2. Add versioned flat save models for GO, CS, and Galaxy; validate byte-for-byte export against
   fixtures from IESE and the historical editors.
3. Migrate the virtual archive/VFS primitives used by Lynx and the map editor.
4. Migrate mod scanning, profiles, and conflict reports.
5. Implement native `mod_merge` in Rust or consume a documented native DLL. Do not substitute a
   process invocation.
6. Only then expose a stable C ABI with explicit allocation/free and error contracts.

## Audit status

- No C# launcher or process adapter was added.
- No CLI subprocess is part of this mapping.
- No historical project was converted or made a dependency of another project.
- This file records observed APIs and required migration boundaries; it does not claim that the
  Rust implementations already exist.
