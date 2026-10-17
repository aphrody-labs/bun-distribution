# Managed DS and 3DS format readers over bun:dotnet

Research snapshot from 2026-10-17. The .NET DS/3DS ecosystem is absorbed as pinned
Git submodules under `vendor/` and exposed to Bun through `bun:dotnet` by
`packages/ds-dotnet` (`@bun-os/ds-dotnet`). No upstream source is copied: the glue
projects compile vendor files in place.

## Inventory

| Project | Licence | Last push | Target | Decision |
| --- | --- | --- | --- | --- |
| [Kuriimu2](https://github.com/FanTranslatorsInternational/Kuriimu2) (`vendor/kuriimu2`, branch `imgui`) | GPL-3.0 | 2026-08 | net10.0 | Absorbed. Konnect plugin host plus Kanvas, Kompression, Kryptography, Komponent, Kaligraphy libraries and the `plugin_nintendo` / `plugin_level5` plugins: NDS, NARC, CIA, NCSD (CCI), NCCH (CXI), GARC, DARC, SARC, BCH, BCLIM/BFLIM, CGFX, CTPK, SMDH, Level-5 packages, `cfg.bin`, T2B-family and image/archive formats. |
| [SPICA](https://github.com/gdkchan/SPICA) (`vendor/spica`) | Unlicense | 2022-08 | .NET Framework 4.7.1 | Absorbed. Only `SPICA/**/*.cs` (H3D, BCH, CGFX, GFL model and texture formats) is compiled into the glue assembly; the OpenTK renderer and WinForms UI are not used. |
| [pk3DS](https://github.com/kwsch/pk3DS) (`vendor/pk3ds`) | GPL-3.0 | 2026-02 | net10.0-windows | Absorbed for `CTR/ExeFS.cs` (ExeFS unpack/pack). Its NCCH/NCSD/RomFS readers are builders tied to WinForms and `Exheader` resources, so Kuriimu2 owns those formats. |
| [Tinke](https://github.com/pleonex/tinke) (`vendor/tinke`) | GPL-3.0 | archived 2022-11 | .NET Framework | Pinned as a reference only (NDS plugin sources, including the Inazuma Eleven plugin already ported to `crates/bun-engine-core/dotnet`). Not built. |
| NdsSharp, NdsSharpPlugins, Level-5 formats (`apps/iecode-dotnet`) | project | n/a | net10.0 | Already owned by the IECODE solution; reused, not re-absorbed. |

Rejected or deferred: Ohana3DS-Rebirth and Ohana3DS-Transfigured (superseded by
SPICA, GPL-2.0 copy), 3DSExplorer (2015, .NET Framework, no 3DS container logic
that Kuriimu2 lacks), DSDecmp (compression is covered by Kompression), 3DNUS (CDN
downloader, out of scope), Level-5 community tools (XtractQuery, CfgBinEditor,
Level5ResourceEditor: unlicensed or GPL editors that duplicate `plugin_level5`).
Re-evaluate XtractQuery if script (`.xq`) decompilation is needed.

## Layout

- `packages/ds-dotnet/dotnet/Aphrody.Ds.csproj`: host assembly (net10.0-windows),
  references Konnect and Kryptography projects, compiles SPICA and pk3DS ExeFS.
- `packages/ds-dotnet/dotnet/plugins/Aphrody.Ds.Plugins.csproj`: compiles the
  Kuriimu2 Nintendo and Level-5 plugins against the in-tree libraries. The
  upstream plugin projects restore Konnect from an authenticated GitHub NuGet
  feed, so they cannot be built from a clean checkout.
- `packages/ds-dotnet/src`: `build.ts` (`bun dotnet build`, output
  `build/ds-dotnet`), `index.ts` (typed API), `cli.ts` (`ds-dotnet`).

The host exports one `[UnmanagedCallersOnly]` entry point
(`Aphrody.Ds.Exports.Invoke`). `index.ts` binds it with `bun:dotnet`
`unmanaged` and exchanges JSON through caller-owned buffers, so the object model
package (`node-api-dotnet`) is not required.

## API

`plugins()`, `identify(path)`, `list(path, plugin?)`, `extract(path, entry, out)`,
`extractAll(path, dir)`, `toPng(path, out, entry?)`, `h3d(path)` (BCH/CGFX
summary), `exefs(path, dir)`, `build()`. Many Kuriimu2 plugins cannot identify
content and are matched by extension (CIA, CGFX); `plugin` accepts a plugin id or
name to force one.

Bun Engine exposes the same commands as `bun-engine ds <command>`.

## Qualification

Verified on the Windows workstation with .NET SDK 10.0.401 resolved by `bun dotnet`:
host and plugin assemblies build; 70 file plugins load with no load errors; a
CIA from `usr/bin/3ds` lists its partitions from the header; an NDS ROM from
`usr/share/rom` lists 1849 files and extracts entries. The test CIAs are
encrypted, so NCCH content inside them needs decrypted dumps. Nothing from
`usr/` is committed.

## Limits

- The host targets `net10.0-windows` because SPICA and pk3DS use `System.Drawing`
  and WinForms types. Linux builds need `System.Drawing.Common` or a split
  assembly; the VPS is not qualified.
- The repository tracks upstream URLs for these submodules. Mirror them under
  `aphrody-labs` when the forge forks exist.
