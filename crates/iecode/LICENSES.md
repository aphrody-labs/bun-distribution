# IECODE native licensing and provenance

## Distribution rule

The combined native emulator artifact is distributed under GPL-family terms.
It incorporates GPL-licensed melonDS source and must retain the applicable
license texts, copyright notices and corresponding source. Apache-2.0 notices
alone do not change that obligation.

IECODE-owned portable files may retain their own permissive notices where one
exists. Linking or combining them into the emulator artifact does not make that
artifact Apache-2.0. Releases must state the license for each deliverable.

## Native component inventory

| Path | Provenance | License evidence |
| --- | --- | --- |
| `src/iecode-cpp/emulation/melonds` | `melonDS-emu/melonDS` at `906e9ebb27da8c6a715cd7abab4abfe8a8d29427` | `LICENSE` (GPL-3.0) |
| `src/iecode-cpp/emulation/melonds/src/dolphin` | Dolphin-derived JIT support | `license_dolphin.txt` |
| `src/iecode-cpp/emulation/melonds/src/teakra` | Teakra DSP emulator | `LICENSE` |
| `src/iecode-cpp/emulation/melonds/src/fatfs` | FatFs | local `LICENSE.txt` |
| `src/iecode-cpp/emulation/melonds/src/tiny-AES-c` | tiny-AES-c | local `unlicense.txt` |
| `src/iecode-cpp/emulation/melonds/src/net/libslirp` | libslirp | local `README.md` and upstream headers |
| `src/iecode-cpp/emulation/melonds/src/blip-buf` | blip-buf | local `license.txt` |

`THIRD_PARTY.md` is the operational inventory used by the license audit. Never
remove a local notice, rewrite an upstream copyright header, or substitute a
README credit for a component license.

## Rust fork source

The source-only Bevy, Dust and Gecko trees and the license-cleared emulator
dependency forks are inventoried with exact revisions in
[`docs/FORK-INTEGRATION.md`](docs/FORK-INTEGRATION.md). Bevy is dual
Apache-2.0/MIT; Dust and Gecko are GPL-3.0; the dependency sources retain
their own Apache-2.0, MIT, Zlib or MPL-2.0 notices. This does not relicense
the combined emulator as Apache-2.0. Unlicensed Git dependencies and the
Solstice IPL are not distributed here.

## Private IEVR source

`crates/ievr-data` was transferred from the `nie` repository under its
separate commercial source-rights boundary. It has `publish = false`, retains
its original source attribution, and is excluded from public crate releases.
The checkout transfer does not relicense it as Apache-2.0, MIT or GPL.
See [`docs/IEVR-DATA-MIGRATION.md`](docs/IEVR-DATA-MIGRATION.md).
