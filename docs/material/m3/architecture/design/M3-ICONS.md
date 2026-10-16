<!-- SPDX-License-Identifier: Apache-2.0 -->
# M3 icons: Material Symbols as SVG

UI icons are inline SVG generated from the Material Symbols variable fonts; no icon font is
loaded at runtime. The fonts in `crates/ui/bun/icons/material-symbols/*.woff2`
(`material-symbols` 0.44.8) are the only outline source.

```
crates/ui/bun, module `icons`        WOFF2 decode -> variable instance -> outline -> SVG path
(formerly crate aphrody-icons)
crates/ui/bun, `icons_ffi`           bun_rs_icon_svg, bun_rs_icon_names (native FFI)
packages/bun                        m3Icon(options), m3IconNames(style)
packages/m3-icons                   <M3Icon>, <m3-icon>, generateIcons, m3IconPlugin
```

## Rust (`bun_rs::icons` (package `aphrody-bun`), formerly the `aphrody-icons` crate and its `svg` feature)

- The module is `std` (the former `no_std` embed-only build and the `svg` feature are gone: its only
  consumer, `aphrody-bun`, always enabled `svg`); it depends on `skrifa`/`read-fonts` and
  `woff2` (`woff2-patched`, workspace dependency).
- Names resolve through the font's own `GSUB` ligatures (feature `rlig`, reached through
  `LookupType 7` extension subtables), never through the published `.codepoints` tables, which
  drift between font releases. The vendored `crates/ui/bun/icons/metadata/codepoints/*.txt` only list which names
  exist.
- Coordinates follow Google's exports: `viewBox="0 -960 960 960"`, `x * 960/upem`,
  `y * -960/upem`; `size` never changes the viewBox.
- API: `icon_svg(name, Style, Axes, size)`, `icon_path(..)`, `icon_names(Style)`. `Axes` defaults
  to FILL 0, wght 400, GRAD 0, opsz 24 (clamped FILL 0..1, wght 100..700, GRAD -25..200,
  opsz 20..48). Decoded fonts are cached once per style.
- `tests/svg_parity.rs` (not in repo) rasterizes generated and Google-exported SVGs and requires pixel equality
  within one step (Outlined fixtures only).

## Bun

- FFI returns `{"ok":true,"svg":...}` / `{"ok":false,"error":...}`, freed with
  `bun_rs_free_string`.
- `@aphrody/m3-icons`: React `<M3Icon>`; Lit `<m3-icon>` (style axis is the `variant`
  attribute, rendered in light DOM so it inherits `currentColor`); `generateIcons({ names, ... })`
  writes one ESM module per icon so apps ship only what they import; `m3IconPlugin` resolves
  `m3:icon/<style>/<name>?fill=&wght=&grad=&opsz=&size=`.

## Known gaps

- 37 of 4,284 outlined names (newer metadata entries) have no ligature in the vendored fonts and
  return `None`; re-vendoring newer fonts closes this.
- Rounded and Sharp have no pixel-parity fixtures.
- `m3IconPlugin` is not wired into `@aphrody/m3`'s plugin yet.
