<!-- SPDX-License-Identifier: Apache-2.0 -->
# Fonts and icons on Windows, Linux and Tauri

How the desktop (WebView2 on Windows, WebKitGTK on Linux) and the `@aphrody/*` web surfaces ship
typefaces and icons. Type scale and axes: [`TYPOGRAPHY.md`](./TYPOGRAPHY.md).

## Decisions

| Concern | Decision | Owner |
| --- | --- | --- |
| Web font format | WOFF2 subsets of the variable sources, every axis kept | `packages/m3-fonts` (`bun run subset`) |
| Latin | One face per family cut to `LATIN_CORE_RANGES` | `src/fonts.css` |
| Japanese | Separate sheet: kana/punctuation chunk + Windows-31J ideographs in 500-codepoint chunks, each with its own `unicode-range` | `src/fonts-jp.css` |
| Material Symbols font | Opt-in sheet, never in the core sheet; UI icons are inline SVG from `@aphrody/m3-icons` | `src/fonts-symbols.css`, `crates/ui/bun/icons` |
| System fallbacks | Bundled faces, then platform faces per OS, then the generic family | `FONT_STACKS` in `packages/m3-fonts/src/index.ts` |
| Delivery in Tauri | Fonts are part of `frontendDist` (`ui-dist`), embedded and served by the custom protocol; no `bundle.resources`, no `asset:` protocol | `@aphrody/m3` `buildM3` |
| CSP | `font-src 'self' data:` (Bun inlines small fonts as `data:` URLs) | `crates/ui/app/tauri.conf.json` |
| App icons | `icon.ico` with 16/24/32/48/64/128/256 layers; PNGs 16-512 for the Linux hicolor theme | `crates/ui/app/icons` |

## Platform notes

- Subsetting uses fontTools in a PEP 723 script run by `uv` (pinned `fonttools`, `brotli`),
  `layout_features=["*"]`, `name_IDs=["*"]`, `recalc_timestamp=False` (reproducible output);
  hinting kept for Latin, dropped for CJK.
- Windows: `system-ui` is Segoe UI Variable; Japanese fallback `Yu Gothic UI`, `Meiryo UI`; code
  `Cascadia Mono`, `Consolas`, then `BIZ UDGothic` / `MS Gothic`. List a Japanese face explicitly,
  otherwise Chromium may pick a Chinese font for shared Han ideographs.
- Linux: fontconfig resolves every family in the stack; `Noto Sans CJK JP`, `Source Han Sans JP`
  and `IPAexGothic` cover Japanese outside the bundled set. Bundled fonts keep the brand look
  independent of distro packages.
- Window and tray icons set from Rust must be embedded (`include_image!` /
  `Image::from_bytes`), never read from `CARGO_MANIFEST_DIR` at runtime.

## Regenerating

```sh
cd packages/m3-fonts
bun run subset   # uv + fontTools -> fonts/web/*.woff2, src/subsets.json, stylesheets
bun run gen      # stylesheets only (after editing the manifest)
bun test src     # sync, sizes, WOFF2 magic, fallbacks
```
