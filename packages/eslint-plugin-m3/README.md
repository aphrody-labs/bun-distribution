<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/eslint-plugin-m3

Lint rules for code that consumes material-web (`@aphrody/m3-react` `Md*` wrappers, `md-*` elements, Material Symbols), for `bun lint` (`jsPlugins`) or ESLint-compatible hosts.

```sh
bun add -d @aphrody/eslint-plugin-m3
```

```json
{
  "jsPlugins": ["./node_modules/@aphrody/eslint-plugin-m3/index.js"],
  "rules": {
    "m3/valid-icon-name": "error",
    "m3/valid-color-role": "error",
    "m3/no-sx-prop": "error",
    "m3/no-mui-prop-on-md": "error",
    "m3/no-mui-import": "warn",
    "m3/prefer-icon-token": "warn",
    "m3/require-icon-button-label": "warn",
    "m3/no-hardcoded-color": "warn"
  }
}
```

That is `.oxlintrc.json` for `bun lint`; the `jsPlugins` path is relative to that file. Plain ESM, no transpilation.

License: Apache-2.0 (`LICENSE`). Install guide: [docs/material/m3/INSTALL.md](https://github.com/aphrody-labs/bun-distribution/blob/os/docs/material/m3/INSTALL.md).

It pairs with `@aphrody/m3-codemods`: what the codemods leave as `MIGRATION-TODO`, these rules keep catching.

## Rules (8)

| Rule                           | Level | Fix  | Catches                                                                                                                                      |
| ------------------------------ | ----- | :--: | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `m3/valid-icon-name`           | error | auto | `<md-icon>` / `<MdIcon>` text that is not a Material Symbols glyph (checked against 4253 glyphs); fixes MUI PascalCase leftovers (`Delete`). |
| `m3/valid-color-role`          | error |  -   | `var(--md-sys-color-<role>)` with a role material-web does not emit (typos, MUI or Tailwind names); suggests the closest role.               |
| `m3/no-sx-prop`                | error |  -   | `sx` on an `md-*` element, where it has no effect; use `className` and `--md-sys-*` tokens.                                                  |
| `m3/no-mui-prop-on-md`         | error | auto | MUI prop names left on a wrapper (`checked` to `selected`, `title` to `text`, `open` to `opened`, `value` to `activeTabIndex`).              |
| `m3/no-mui-import`             | warn  |  -   | Remaining `@mui/material`, `@mui/icons-material` or `@mui/x-*` imports.                                                                      |
| `m3/prefer-icon-token`         | warn  |  -   | Inline `fontVariationSettings` on an icon; use `--md-icon-fill`, `--md-icon-wght`, `--md-icon-grad`, `--md-icon-opsz`.                       |
| `m3/require-icon-button-label` | warn  |  -   | Icon buttons without an accessible name (`aria-label`, `aria-labelledby`, `title`); WCAG 4.1.2.                                              |
| `m3/no-hardcoded-color`        | warn  |  -   | Hard-coded `#hex` / `rgb()` in `style` or `sx` of an `md-*` element; use a `var(--md-sys-color-*)` role.                                     |

`bun lint --fix` applies the two autofixes (`valid-icon-name`, `no-mui-prop-on-md`).

## Presets (ESLint flat config)

```js
import m3 from "@aphrody/eslint-plugin-m3";

export default [m3.configs.recommended]; // or m3.configs.strict: every rule as an error
```

## Development

```sh
bun test/run.ts                    # bun lint over the fixtures (every rule fires on bad, none on good)
bun scripts/sync-symbol-names.ts   # regenerate data/material-symbols-names.js
```

The glyph list (`data/material-symbols-names.js`) is generated from `../m3-codemods/data/material-symbols-names.json`
(official codepoints of `google/material-design-icons`, Apache-2.0); `prepack` runs the sync.
