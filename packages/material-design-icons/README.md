<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/material-design-icons

The Material Symbols catalogue as plain SVG files (no icon font, no native binding), for desktop icons, sprites and
OS icon themes; in-app runtime icons stay on `@aphrody/m3-icons`.

```sh
bun add @aphrody/material-design-icons
```

```ts
import {
  hasSymbol,
  readSymbolSvg,
  symbolNames,
} from "@aphrody/material-design-icons";

symbolNames().length; // 4150 once the catalogue is materialised
if (hasSymbol("home", "rounded")) readSymbolSvg("home", "rounded", 400, true);
```

The functions read `vendor/material-design-icons/symbols/web` of a Bun OS checkout (`bun run icons:sync`
materialises it); the npm package does not ship the SVG catalogue.

License: Apache-2.0 (`LICENSE`). Install guide: [docs/material/m3/INSTALL.md](https://github.com/aphrody-labs/bun-distribution/blob/os/docs/material/m3/INSTALL.md).

The fork holds about 2.1M SVG variants, so a normal checkout is not viable. `icons:sync` fetches only the
wanted blobs and writes them with an exact-path sparse checkout.

| Script                                                       | What it does                                                                                                                                                                                                    |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run icons:sync`                                         | Materialise every symbol x outlined/rounded/sharp x regular/fill at 24px (4 150 symbols, 24 900 files, ~160 MB). `--weights 300,500`, `--sizes 20,40,48`, `--grades 200,-25` add variants.                      |
| `bun run icons:check`                                        | Exit 0 when the catalogue is fully materialised.                                                                                                                                                                |
| `bun run icons:export --out dist/icons`                      | Write `names.json`, six `sprite-<style>[-fill].svg` sprites and a freedesktop theme (`index.theme`, `scalable/material/*` for the whole catalogue, 51 standard names mapped onto it) for GNOME, COSMIC and KDE. |
| `bun run icons:ico <symbol\|file.svg> --out src-tauri/icons` | `tauri icon` pipeline: `icon.ico`, `icon.icns`, PNG set (`yolo m3 svg-to-ico`; npm bin `m3-svg-to-ico`).                                                                                                        |

Windows 11, GNOME Shell, COSMIC and Chromium theme installers live in `@aphrody/m3-os-themes`; point them at the
exported sprite or freedesktop theme.
