<!-- SPDX-License-Identifier: Apache-2.0 AND MIT -->

# @aphrody/m3-explorer

Material Design 3 file-management components for React: a tag chip, an inline rename field, a file
thumbnail and a selectable grid tile. They are presentational: props in, callbacks out, no data
fetching, no context. Consumers wire their own state.

This is SpaceUI's `@spacedrive/explorer` rebuilt on Material Design 3. The upstream source lives in
`packages/aphrody-spaceui/packages/explorer`; the fusion rules are in
[`docs/design/SPACEUI-M3-FUSION.md`](../../docs/architecture/design/SPACEUI-M3-FUSION.md).

## Install

```sh
bun add @aphrody/m3-explorer @aphrody/m3-primitives
bun add @aphrody/assets   # optional: file-kind icons and extension badges
```

Peer dependencies: `react` and `react-dom` 18 or 19, `tailwindcss` 4.1+.

## CSS setup

The components use the M3 Tailwind utilities. Import the token sheets and let Tailwind scan the
package, as described in
[`SPACEUI-M3-FUSION.md` → Integration](../../docs/architecture/design/SPACEUI-M3-FUSION.md#integration):

```css
@import "tailwindcss";
@import "@aphrody/m3-tokens/m3-tokens.css";
@import "@aphrody/m3-theme/spaceui.css"; /* or tokens.css */
@import "@aphrody/m3-theme/tailwind.css";

@source "../node_modules/@aphrody/m3-primitives/dist";
@source "../node_modules/@aphrody/m3-explorer/dist";
```

`TagPill`'s remove button is a Material Symbols `close` glyph: register the font once with
`ensureMaterialSymbols()` from `@aphrody/material-web/icon/material-symbols.js`.

## Components

### `TagPill`

An M3 input / filter chip: `rounded-small`, 1dp `outline-variant` border, `text-label-large` in
`on-surface-variant`, a state layer when clickable. The tag color is user data, so it stays on the
leading dot only. `selected` switches to the filter-chip selected state
(`bg-secondary-container text-on-secondary-container`, no border).

| Prop                  | Type                   | Notes                                                                   |
| --------------------- | ---------------------- | ----------------------------------------------------------------------- |
| `color`               | `string`               | Any CSS color, used for the dot.                                        |
| `size`                | `"xs" \| "sm" \| "md"` | M3 density steps: `md` 32dp (baseline), `sm` 28dp (default), `xs` 24dp. |
| `selected`            | `boolean`              | Filter-chip selected state.                                             |
| `onClick`, `onRemove` | `(e) => void`          | `onRemove` adds a trailing 18px `close` icon with its own state layer.  |

```tsx
<TagPill color="#ef4444" onRemove={() => removeTag(id)}>
  Important
</TagPill>
```

### `RenameInput`

Inline rename as a dense M3 filled text field: `bg-surface-container-highest`,
`rounded-extra-small`, `text-body-medium`, a 2dp `primary` outline while focused, primary-container
text selection. The stem is selected on mount and the extension is a read-only suffix. Enter saves
(`onSave` receives the full name and may reject to keep editing), Escape and blur cancel; an empty
or unchanged name cancels.

```tsx
<RenameInput name="report" extension="pdf" onSave={async (next) => rename(next)} onCancel={stop} />
```

### `FileThumb`

The kind icon renders at once; the thumbnail loads over it and hides it once loaded; an extension
badge ("bearded icon") overlays small kinds. The default thumbnail frame is `rounded-small` with an
`outline-variant` border on `surface-container-high` (the corner scales down below 100px);
`selected` adds a 2dp `primary` outline; `frameClassName` replaces the frame.

`iconSrc` and `thumbnailSrc` take an `IconSource` (this package's type: a URL string or
`{ src: string }`), which is what bundlers return for image imports.

### `GridItem`

An M3 selectable grid tile: `rounded-medium`, an `on-surface` state layer (8 % hover, 10 % pressed),
`bg-secondary-container` with `on-secondary-container` content when `selected`, the M3 focus ring,
the name in `text-label-medium` on up to two lines, size text or a `volumeBar`, and up to three tag
dots plus a `+N` count.

## Kind icons: `@aphrody/assets`

The components take icon URLs and do not depend on an icon set. `@aphrody/assets` (SpaceUI's
`@spacedrive/icons`) provides the matching assets:

```tsx
import { getBeardedIcon, getIcon } from "@aphrody/assets/util";
import { GridItem } from "@aphrody/m3-explorer";

// getBeardedIcon returns a badge name ("reactts"); serve or import
// @aphrody/assets/svgs/ext/Extras/<name>.svg and pass its URL.
const badge = getBeardedIcon("tsx");

<GridItem
  name="App"
  extension="tsx"
  sizeText="4 KB"
  thumb={{
    iconSrc: getIcon("Code", isDark, "tsx"), // a bundler-resolved asset: URL or { src }
    beardedIconSrc: badge ? `/assets/ext/${badge}.svg` : null,
  }}
  selected={selected}
  onClick={select}
/>;
```

Material Symbols stay the source for UI glyphs (actions, status); the file-kind artwork is not
recolored by the M3 palette.

## Credits and license

Derived from [SpaceUI](https://github.com/spacedriveapp/spaceui) `@spacedrive/explorer`, MIT,
© Spacedrive (see `LICENSE.spaceui`). The Material Design 3 rebuild is Apache-2.0; the package is
published as `Apache-2.0 AND MIT`.
