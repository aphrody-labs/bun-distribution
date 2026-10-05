<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/m3-primitives

Material Design 3 React primitives. This is the SpaceUI component set (`@spacedrive/primitives`,
MIT, © Spacedrive, vendored in `packages/aphrody-spaceui`) rebuilt on the aphrody M3 system: M3 color
roles and state layers, the 10-step shape scale, the M3 typescale, the M3 focus ring, elevation,
Material Symbols and the M3 easings of `@aphrody/m3-motion`. [Base UI](https://base-ui.com)
(`@base-ui/react`) is the headless layer: it owns behavior, keyboard interaction, focus
management and accessibility, and drives the M3 enter / exit motion through its
`data-starting-style` / `data-ending-style` attributes. Every upstream export and prop still
works; the Radix-era props (`asChild`, `checked="indeterminate"`, `delayDuration`,
`forceMount`, `onSelect`, array slider values) are mapped onto Base UI, and Base UI props are
accepted as well.

Fusion rules, token mapping and the Material Web equivalents of each component:
[`docs/design/SPACEUI-M3-FUSION.md`](../../docs/architecture/design/SPACEUI-M3-FUSION.md).

## Install

```sh
bun add @aphrody/m3-primitives @aphrody/m3-theme @aphrody/m3-tokens
```

Peers: `react` and `react-dom` 18 or 19, `tailwindcss` 4.1+.

## Styles

The components are styled with M3 Tailwind utilities (`bg-surface-container`,
`text-on-surface-variant`, `rounded-full`, `text-label-large`, `hover:bg-on-surface/8`), so the app
compiles them with Tailwind v4:

```css
@import "tailwindcss";
@import "@aphrody/m3-tokens/m3-tokens.css"; /* shape, typescale, elevation, motion, state */
@import "@aphrody/m3-theme/spaceui.css"; /* SpaceUI themes as M3 schemes — or tokens.css */
@import "@aphrody/m3-theme/tailwind.css"; /* M3 utilities */
@source "../node_modules/@aphrody/m3-primitives/dist";
```

Icons use the Material Symbols font; register it once:

```ts
import { ensureMaterialSymbols } from "@aphrody/material-web/icon/material-symbols.js";
ensureMaterialSymbols();
```

## Usage

```tsx
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Icon,
  Input,
} from "@aphrody/m3-primitives";

export function Welcome() {
  return (
    <Card variant="elevated">
      <CardHeader>
        <CardTitle>Welcome</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input placeholder="Your name" icon="person" />
        <Button variant="filled">
          <Icon name="arrow_forward" size={18} /> Get started
        </Button>
      </CardContent>
    </Card>
  );
}
```

## Components

| Group              | Components                                                                                                                                                                                                  | M3 anatomy                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Actions            | `Button` (`filled`, `tonal`, `outlined`, `text`, `elevated` + the SpaceUI variants), `CircleButton`, `CircleButtonGroup`, `ShinyButton`, `ShinyToggle`, `FilterButton`, `SelectPill`, `SelectTriggerButton` | Common buttons, icon buttons, connected group, filter chip       |
| Selection          | `CheckBox`, `RadixCheckbox`, `Switch`, `Slider`, `RadioGroupRoot/Item`, `ToggleGroup`, `OptionList`                                                                                                         | Checkbox, switch, slider, radio, segmented button                |
| Text input         | `Input`, `SearchInput`, `PasswordInput`, `TextArea`, `Label`, `SearchBar`, `NumberStepper`, `Select`                                                                                                        | Outlined / filled text fields, search bar, exposed dropdown menu |
| Navigation         | `TabsRoot/List/Trigger/Content`, `TabBar`, `SpaceItem`                                                                                                                                                      | Primary tabs, navigation-drawer item                             |
| Menus and overlays | `Dialog` (+ `dialogManager`, `useDialog`), `Popover`, `Tooltip`, `Kbd`, `DropdownMenu`, `ContextMenu`, `Dropdown`                                                                                           | Basic dialog, menus, plain tooltip                               |
| Feedback           | `toast`, `Toaster`, `Loader`, `ProgressBar`, `CircularProgress`, `Banner`, `InfoBanner`, `Badge`                                                                                                            | Snackbar, progress indicators, banners, badges and assist chips  |
| Containment        | `Card` (`elevated`, `filled`, `outlined`), `Divider`, `Collapsible`, `Resizable`, `LayoutCard`, `GridLayout`                                                                                                | Cards, divider, expansion panel                                  |
| Type               | `CategoryHeading`, `ScreenHeading`, `Shortcut`                                                                                                                                                              | Title small, headline small, key chips                           |
| Forms              | `Form`, `ErrorMessage`, `errorStyles`, `z`                                                                                                                                                                  | Error supporting text                                            |
| Helpers            | `Icon`, `renderIcon`, `IconSource`, `PHOSPHOR_TO_SYMBOL`, `m3StateLayer`, `m3FocusRing`, `tw`, surface class names, key symbols                                                                             |                                                                  |

Sizes: the default (`md`/unset) is the M3 baseline height; smaller sizes are M3 density steps.

## Coming from `@spacedrive/primitives`

Rename the import. Phosphor icon props still compile (they accept an `IconSource`: a Material
Symbols name, an element or a component). Visible differences: M3 heights (inputs default to 56,
icon buttons to 40), pill-shaped buttons, `secondary-container` selection, Material Symbols glyphs,
`Select` opens below its field, `Collapsible` draws an `expand_more` indicator (`indicator={false}`
to opt out).

## Development

```sh
bun run typecheck
bun test          # happy-dom preloaded by bunfig.toml
bun run build     # tsup + declarations
```

## Licence

Apache-2.0 AND MIT: aphrody changes under Apache-2.0, SpaceUI-derived code under MIT
(`LICENSE.spaceui`).
