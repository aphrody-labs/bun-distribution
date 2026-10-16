<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/material-design-icons

The full Material Symbols catalogue from the fork `vendor/material-design-icons`, as plain SVG files
(no icon font, no native binding). It feeds every surface that needs real files: Tauri desktop icons,
the wxwasm OS, web sprites and the Linux icon theme. In-app runtime icons stay on `@aphrody/m3-icons`.

The fork holds about 2.1M SVG variants, so a normal checkout is not viable. `icons:sync` fetches only the
wanted blobs and writes them with an exact-path sparse checkout.

| Script                                                       | What it does                                                                                                                                                                                                    |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run icons:sync`                                         | Materialise every symbol x outlined/rounded/sharp x regular/fill at 24px (4 150 symbols, 24 900 files, ~160 MB). `--weights 300,500`, `--sizes 20,40,48`, `--grades 200,-25` add variants.                      |
| `bun run icons:check`                                        | Exit 0 when the catalogue is fully materialised.                                                                                                                                                                |
| `bun run icons:export --out dist/icons`                      | Write `names.json`, six `sprite-<style>[-fill].svg` sprites and a freedesktop theme (`index.theme`, `scalable/material/*` for the whole catalogue, 51 standard names mapped onto it) for GNOME, COSMIC and KDE. |
| `bun run icons:ico <symbol\|file.svg> --out src-tauri/icons` | `tauri icon` pipeline: `icon.ico`, `icon.icns`, PNG set (`yolo m3 svg-to-ico`; npm bin `m3-svg-to-ico`).                                                                                                        |

```ts
import {
  symbolNames,
  readSymbolSvg,
  hasSymbol,
} from "@aphrody/material-design-icons";

symbolNames().length; // 4150
readSymbolSvg("home", "rounded", 400, true);
```

Windows 11, GNOME Shell, COSMIC and Chromium theme installers live in `@aphrody/m3-os-themes`; point them at the
exported sprite or freedesktop theme.
