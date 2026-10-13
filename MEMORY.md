# Material integration evidence

13 October 2026: Aphrody's native consumers now resolve `aphrody-m3-tokens`
from this Material revision. On native Windows, locked Cargo metadata and a
locked scoped check passed for Aphrody app, Bun UI, identity, M3 components,
M3 reproduction and SVG packages. Aphrody excludes its duplicate token crate
from its Cargo workspace and redirects its font consumers to this checkout.
The duplicate source directory remains physically present because the host
tool policy rejected its recursive removal. Tests were not run; source deletion
is still open.

13 October 2026: the reduced private OS-theme copy in `aphrody-m3` was replaced
by its shared `aphrody-m3-os-themes` owner at `27b36bd`; framework commit
`393d397` now resolves the same Windows, GNOME, COSMIC and Chromium sources as
the Material desktop packages. The validated native `ThemeExport` adapter has
one implementation in `aphrody-m3/packages/m3-tokens`; the top-level token
package re-exports it. The CLI uses the neutral M3 baseline by default and
accepts a product seed from the host. Native colors remain owned by the Rust
token crate. Bun lint/fmt and the five-export import probe passed. The focused
type check stops in the pinned MCU source checkout on its own `verbatimModuleSyntax`
and unused-parameter errors; no tests were run.

13 October 2026: the owned libm3 and libm3-wasm sources moved from the
distribution checkout into this workspace on branch os. Concurrent package
submodule work remains with its authors. The previous scalar WASM build
qualified a duplicated baseline contract; it does not qualify this correction.

The existing native token engine is the integration source. Native GUI,
cross-platform desktop and complete Material application qualification remain open.

The corrected no_std and std facade compiled with the existing token owner.
The Windows native COSMIC feature compiled with libcosmic 7f715bc5. The scoped
theme adapter also covers inherited controls and their overlays.

The dynamic WASM ABI 2 built to 113528 bytes with SHA-256
c1abee38ea03c33b8150c14ef987906759182a6fd693c636b960922962c69ed8.
It executed without host imports and exposed native role/variant names, all
nine variants and validated opaque seeds. A new green seed changed Primary
from ff65558f to ff1f6a4e. Widths 599/840/1200 returned bar/collapsed rail/
expanded rail. These checks qualify this contract, not a displayed GUI.

Consolidation restored the existing native component engine under crates/m3,
including its control models, keyboard, accessibility, focus, forms and Taffy
composition. libm3's std facade re-exports these models. The locked resolved
graph has one local aphrody-m3-tokens 1.4.4 owner. Default upstream Rustfmt
replaces the transferred legacy formatting configuration; input and normalized
output hashes remain in crates/m3/transfer-receipt.json.

Material web submodules declare update=none for Cargo acquisition. Full web
bootstrap explicitly uses git submodule update --init --recursive --checkout.
Consumer workspace roots must repeat the token patch using the same Git URL
and exact Material revision. This dependency patch is not inherited.

The unqualified Aphrody Cargo transition was reverted after a recursive
submodule acquisition timeout. Its original clean token/component inputs,
lockfile and concurrent work remain. Publisher authentication was unavailable;
no crates.io publish or pointer to a nonexistent release was created. The
first published native correction is ce47e503; later consolidation commits
are identified by the os branch's Git history.
