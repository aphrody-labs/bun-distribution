# @aphrody/m3-fonts

The Aphrody M3 typefaces as `@font-face` CSS and a typed manifest: Google Sans Flex (brand), Google
Sans Code, Roboto Flex, Roboto Mono and Material Symbols (outlined, rounded, sharp), with Japanese
fallbacks (Noto Sans JP, M PLUS 1 Code).

| Import                                | Contents                                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `@aphrody/m3-fonts`                   | `FONTS`, `FONT_STACKS`, `SUBSETS`, `SUBSET_JOBS`, `fontFaceCss`, `faceRule`, `renderStylesheet`, `UPSTREAM_DIR` |
| `@aphrody/m3-fonts/fonts.css`         | Latin core faces (always imported, < 3 MiB)                                                                     |
| `@aphrody/m3-fonts/fonts-jp.css`      | Japanese faces chunked by `unicode-range`                                                                       |
| `@aphrody/m3-fonts/fonts-symbols.css` | Material Symbols variable fonts (opt-in; `@aphrody/m3-icons` renders SVG)                                       |
| `@aphrody/m3-fonts/fonts/*`           | the font files                                                                                                  |

Files:

- `fonts/web/*.woff2`: the subsets served to browsers (tracked), recorded in `src/subsets.json`.
- `fonts/*.ttf`, `fonts/*-OFL.txt`: tracked variable sources and licences.
- `fonts/upstream/`: Google Sans Flex/Code sources (fork `aphrody-labs/fonts` of `google/fonts`) and
  Material Symbols (`material-symbols@0.44.8`, the build the Rust icons module renders). Not tracked:
  `bun scripts/m3/fonts-sync.ts` at the repository root fetches them, verifying each sha256 and size
  pinned in `fonts.lock.json` (`--check` verifies only).

Scripts: `gen` (stylesheets from the manifest), `subset` (fontTools through uv, `scripts/subset.py`),
`typecheck`, `test` (fonts sync, then the manifest, file, lock and stylesheet checks).
