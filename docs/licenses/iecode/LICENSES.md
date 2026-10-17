# IECODE licensing and source rights

Each deliverable retains the terms of the source it actually incorporates.
Workspace membership or a package-manager manifest does not grant rights to
redistribute game inputs, proprietary data, or unrelated source.

## Portable C++ and combined emulator

The `iecode-cpp-release` preset builds the portable core and CLI with
`BUILD_MELONDS=OFF` and engine/game disabled. It does not incorporate melonDS
merely because an optional melonDS build is declared. This distinction does not
assign a new license to the portable artifact: retain IECODE source terms and
all linked dependency notices when distributing its CLI or static libraries.

A combined artifact incorporating GPL-licensed melonDS must satisfy its
applicable GPL terms, including notices, license texts and corresponding
source. Apache-2.0 notices alone do not relicense that combined artifact.
The historical melonDS import was `melonDS-emu/melonDS` revision
`906e9ebb27da8c6a715cd7abab4abfe8a8d29427`; its checkout is currently absent.
The root CMake graph skips it unless a source checkout is provided.
Historical component provenance and notice names remain in [THIRD_PARTY.md](THIRD_PARTY.md).

## Retained emulator and dependency source

Dust, Gecko and Ruzu retain their GPL-family source notices. The portable
`aphrody-wii` and `aphrody-aarch64` releases declare GPL-3.0-only and
GPL-3.0-or-later respectively. Other retained dependency sources keep their own
Apache-2.0, MIT, Zlib or MPL-2.0 terms; do not infer a common license from the
workspace. Bevy, wgpu and `lua-src` are resolved through Cargo, not local forks.
Unlicensed Git inputs and the Solstice IPL are not distributed here.

Local header libraries and the Lua 5.2.4 snapshot retain their license text.
The former console SDK snapshots and melonDS components are historical inventory,
not present build inputs. Their recorded origins remain in
[THIRD_PARTY.md](THIRD_PARTY.md) and
[console SDK provenance](src/iecode-cpp/third_party/CONSOLE-SDKS.md).
Never remove component notices or substitute a README credit for their terms.

## NIE commercial source-rights boundary

The former `ievr-data` source is now owned by
`crates/nie/aphrody-nie-data`; the obsolete `crates/ievr-data` path is not a
release entry point. It inherits the root workspace's `publish = false` and
`license-file = "docs/nie/LICENSE"`. The retained
[NIE agreement notice](docs/nie/LICENSE) governs its separate commercial
source-rights boundary. A checkout transfer does not relicense it as
Apache-2.0, MIT or GPL. Public portable crates and permissively licensed language
packages do not grant rights to distribute private ROMs, dumps, keys or game data.
