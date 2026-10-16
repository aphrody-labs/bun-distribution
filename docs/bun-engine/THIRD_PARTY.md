# Emulation provenance and licenses

The following packages were extracted from `aphrody-labs/iecode` commit
`58fc06ffe480415c847415d187aa295215423226`:

| Package             | License          | Scope                                                                                 |
| ------------------- | ---------------- | ------------------------------------------------------------------------------------- |
| `aphrody-aarch64`   | GPL-3.0-or-later | Portable AArch64 decoder and bounded interpreter extracted from Rydynarmic/Ruzu work. |
| `aphrody-switch`    | GPL-2.0-or-later | Portable Switch CPU and Tegra texture primitives.                                     |
| `aphrody-wii`       | GPL-3.0-only     | Portable Wii DOL loading and Broadway branch execution.                               |
| `aphrody-wii-image` | GPL-3.0-only     | Wii/GameCube ISO, DOL, DVD and banner parsers.                                        |

The complete applicable GPL text is retained in each package. No Nintendo ROM,
BIOS, firmware, key, game data, or IECODE NIE/IEVR implementation is included.

Optional RVZ and ELF/IDB symbol parser sources remain present for provenance,
but are not exposed as Cargo features in this qualified lot because their full
dependency and license set has not yet been migrated.
