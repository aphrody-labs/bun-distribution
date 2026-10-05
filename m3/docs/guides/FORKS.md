# Forks

M3 vendors no fork. `config/vendor.json` lists Bun (`vendor/bun`) as the only on-demand source, fetched by
`bun scripts/tools/vendor/fetch.ts`.

| Package | Source |
| --- | --- |
| `@aphrody/material-web` | registry package (root catalog), published from `aphrody-labs/material-web` |
| `@material/material-color-utilities` | registry package (root catalog) |
| `@aphrody/m3-fonts` | `fonts.lock.json`: files pinned by sha256, downloaded from the pinned raw URL by `scripts/fonts-sync.ts` |
| `m3-bun` icons (`m3:icons/...`) | fetched once from the Material Symbols CDN (`M3_ICONS_ORIGIN`, default fonts.gstatic.com; cdn.aphrody.com once live) into `~/.cache/aphrody/material-symbols`; `M3_ICONS_ROOT` selects a local catalogue |
| `@aphrody/material-design-icons` | a local catalogue checkout (`M3_ICONS_ROOT`) |

The fork repositories (`aphrody-labs/material-web`, `material-color-utilities`, `material-design-icons`, `fonts`)
remain on GitHub; their last pins are in the history of `config/vendor.json` (before 2026-10-05).
