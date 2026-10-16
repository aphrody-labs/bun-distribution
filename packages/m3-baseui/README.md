<!-- SPDX-License-Identifier: Apache-2.0 -->

# `@aphrody/m3-baseui`

Material 3 for [Base UI](https://base-ui.com) (`@base-ui/react` from the root catalog; pinned upstream sources live in `vendor/base-ui`). Base UI
keeps behaviour, accessibility and the `data-*` state attributes; this package adds the M3 classes and the stylesheets that
paint them from the `--md-sys-*` tokens. Every Base UI primitive is wrapped: 38 components, 0 CSS-in-JS, no MUI.

```tsx
import "@aphrody/m3-tokens/m3-tokens.css";
import "@aphrody/m3-tokens/expressive.css";
import "@aphrody/m3-baseui/m3-baseui.css"; // or core.css + the sheets you use, below
import { M3Button, M3Dialog, M3Select, M3Switch } from "@aphrody/m3-baseui";

<M3Button variant="tonal" size="md">
  Save
</M3Button>;

<M3Dialog.Root>
  <M3Dialog.Trigger render={<M3Button variant="text" />}>
    Delete
  </M3Dialog.Trigger>
  <M3Dialog.Portal>
    <M3Dialog.Backdrop />
    <M3Dialog.Popup>
      <M3Dialog.Title>Delete the file?</M3Dialog.Title>
      <M3Dialog.Description>It cannot be undone.</M3Dialog.Description>
      <M3Dialog.Close render={<M3Button variant="text" />}>
        Cancel
      </M3Dialog.Close>
    </M3Dialog.Popup>
  </M3Dialog.Portal>
</M3Dialog.Root>;
```

## Shape of the API

- **Single-element primitives are components**: `M3Button` (`variant` filled, tonal, outlined, text, elevated; `size` xs, sm, md,
  lg, xl), `M3Input` (`variant` outlined, filled), `M3Toggle`, `M3ToggleGroup` (segmented button), `M3Separator`, `M3Form`,
  `M3RadioGroup`, `M3CheckboxGroup`, `M3Menubar`.
- **Closed forms** of the three controls with fixed internals: `M3Switch`, `M3Checkbox`, `M3Radio`. Their parts are flat
  exports for custom content: `M3SwitchRoot` and `M3SwitchThumb`, `M3CheckboxRoot` and `M3CheckboxIndicator`,
  `M3RadioRoot` and `M3RadioIndicator`.
- **Multi-part primitives are namespaces** that mirror Base UI: `M3Accordion`, `M3AlertDialog`, `M3Autocomplete`, `M3Avatar`,
  `M3Collapsible`, `M3Combobox`, `M3ContextMenu`, `M3Dialog`, `M3Drawer`, `M3Field`, `M3Fieldset`, `M3Menu`, `M3Meter`,
  `M3NavigationMenu`, `M3NumberField`, `M3OtpField`, `M3Popover`, `M3PreviewCard`, `M3Progress`, `M3ScrollArea`, `M3Select`,
  `M3Slider`, `M3Tabs`, `M3Toast`, `M3Toolbar`, `M3Tooltip`. Parts without a visual role (`Root`, `Portal`, `Trigger`,
  `createHandle`, `useToastManager`, ...) are Base UI's own, so a namespace has exactly the parts Base UI has (a test compares
  them against the installed Base UI).
- Non-visual helpers are re-exported: `CSPProvider`, `DirectionProvider`, `useDirection`, `mergeProps`, `useRender`.
- `className` stays a string or a state function (`(state) => string`), the M3 classes come first; `ref` is an ordinary prop
  (React 19, no `forwardRef`); `render` composes as in Base UI.
- Every wrapper module is `'use client'`, so Server Components render the wrappers with plain props.

## Per-component modules and sheets

`@aphrody/m3-baseui/<name>` is the module of one primitive (`@aphrody/m3-baseui/dialog` exports `Root`, `Popup`, ...) and
`@aphrody/m3-baseui/css/<name>.css` its sheet. `css/core.css` is required with any of them: type shorthands, the state layer,
the focus ring, the popup surface and the menu item.

| Components                                                                                                              | Sheet                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Button                                                                                                                  | `button.css`                                                                                                                                                                      |
| Toggle, ToggleGroup                                                                                                     | `toggle.css`                                                                                                                                                                      |
| Checkbox, CheckboxGroup                                                                                                 | `checkbox.css` (group layout is in `core.css`)                                                                                                                                    |
| Radio, RadioGroup                                                                                                       | `radio.css`                                                                                                                                                                       |
| Switch                                                                                                                  | `switch.css`                                                                                                                                                                      |
| Input, Field, Fieldset, Form                                                                                            | `field.css`                                                                                                                                                                       |
| NumberField, OtpField                                                                                                   | `number-field.css`, `otp-field.css`                                                                                                                                               |
| Select                                                                                                                  | `select.css`                                                                                                                                                                      |
| Menu, ContextMenu, Menubar                                                                                              | `menu.css`                                                                                                                                                                        |
| Combobox, Autocomplete                                                                                                  | `combobox.css`                                                                                                                                                                    |
| Dialog, AlertDialog                                                                                                     | `dialog.css`                                                                                                                                                                      |
| Drawer                                                                                                                  | `drawer.css`                                                                                                                                                                      |
| Popover, PreviewCard                                                                                                    | `popover.css`                                                                                                                                                                     |
| Tooltip                                                                                                                 | `tooltip.css`                                                                                                                                                                     |
| Tabs, Slider, Progress and Meter, Accordion, Collapsible, Avatar, Separator, ScrollArea, Toolbar, NavigationMenu, Toast | `tabs.css`, `slider.css`, `progress.css`, `accordion.css`, `collapsible.css`, `avatar.css`, `separator.css`, `scroll-area.css`, `toolbar.css`, `navigation-menu.css`, `toast.css` |

## Styling rules

- Every rule is inside `@layer components`: Tailwind utilities (`utilities` layer) and your unlayered CSS always win, with no
  specificity fights. Without Tailwind the layer is harmless.
- Colours come only from tokens (`--md-sys-color-*`; disabled and scrims use `color-mix` of a token). A test fails on a
  literal colour, on a token that is not defined in `@aphrody/m3-tokens`, on a wrapper class without a rule and on a rule
  without a wrapper.
- State layers use `--md-sys-state-*-state-layer-opacity` through `.m3-bui-state` (hover, focus, pressed; `data-highlighted`
  for menu items). Motion uses `--md-sys-motion-*`; `prefers-reduced-motion` shortens every transition and animation.
- Expressive touches: buttons tighten their corners while pressed, a selected toggle becomes square, the drawer uses the
  directional `extra-large-top` and `large-start|end` corners, the switch thumb grows 16, 24 and 28dp.
- Tailwind v4 users get the matching variants from `@aphrody/m3-tailwind` (`m3-open:`, `m3-on:`, `m3-highlighted:`, ...).

The imported source owner is not wired into the consumer build. Local source integration requires migrating its React and utils leaves, their configuration and quality gates into the root workspace first.

`bun test`, `bun run typecheck`, `bun run lint`.
