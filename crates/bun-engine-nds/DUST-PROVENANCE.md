# Dust source provenance

- Source repository: https://github.com/aphrody-labs/iecode
- Source revision: `ba98a9413704efc2e9aeb6262ddfb16746fe016d`
- Original project: https://github.com/kelpsyberry/dust
- License: GPL-3.0-or-later

Imported paths:

- `crates/emu/core/src` -> `dust-core/src`
- `crates/emu/utils/src` -> `emu-utils/src`
- `crates/emu/utils/macros/src` -> `emu-utils-macros/src`

The proc-macro remains a private companion crate because Cargo cannot expose a
procedural macro and a normal runtime library from one crate type. All three
packages remain inside the single `crates/nds` product owner.
