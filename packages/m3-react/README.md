<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/m3-react

Typed React components for every `md-*` element of `@aphrody/material-web`, generated with `@lit/react` `createComponent`.

```sh
bun add @aphrody/m3-react @aphrody/material-web react react-dom
```

```tsx
import {
  MdCheckbox,
  MdFilledButton,
  MdOutlinedTextField,
} from "@aphrody/m3-react";

export function SignIn() {
  return (
    <form>
      <MdOutlinedTextField
        label="Email"
        onInput={e => console.log((e.target as HTMLInputElement).value)}
      />
      <MdCheckbox
        onChange={e => console.log((e.target as HTMLInputElement).checked)}
      />
      <MdFilledButton type="submit">Sign in</MdFilledButton>
    </form>
  );
}
```

License: Apache-2.0 (`LICENSE`). Install guide: [docs/material/m3/INSTALL.md](https://github.com/aphrody-labs/bun-distribution/blob/os/docs/material/m3/INSTALL.md).

One wrapper per tag (PascalCase of the tag name), with the element's real native events mapped to React props. Importing a
wrapper registers its custom element as a side effect (the wrapper imports the `@aphrody/material-web` module that calls
`customElements.define`); no other import is needed. The elements are Lit web components, so they render on the client;
see [FRAMEWORKS.md](FRAMEWORKS.md) for SSR and RSC setups.

| Import                                | Contents                                           |
| ------------------------------------- | -------------------------------------------------- |
| `@aphrody/m3-react`                   | All wrappers (`MdFilledButton`, `MdDialog`, ...)   |
| `@aphrody/m3-react/<group>`           | One wrapper group, e.g. `@aphrody/m3-react/button` |
| `@aphrody/m3-react/transitions`       | `Collapse`, `Fade`, `Grow`, `Slide`, `Zoom`        |
| `@aphrody/m3-react/adaptive`          | Window size class hooks (SSR-safe)                 |
| `@aphrody/m3-react/state`             | `useTextFieldState`, `bindTextFieldState`          |
| `@aphrody/m3-react/data`              | `DataTable`, `VirtualList`                         |
| `@aphrody/m3-react/adapters/tanstack` | TanStack Table adapter                             |

Controlled inputs read `e.target.value` / `e.target.checked`; the handler receives the DOM event, not `(event, value)`.

## Slots and icons

Sub-parts are slotted content:

```tsx
import {
  MdDialog,
  MdFilledButton,
  MdIcon,
  MdTextButton,
} from "@aphrody/m3-react";

<MdDialog
  open
  onClosed={e => console.log((e.target as HTMLDialogElement).returnValue)}
>
  <div slot="headline">Delete?</div>
  <form slot="content" method="dialog">
    This cannot be undone.
  </form>
  <div slot="actions">
    <MdTextButton value="cancel">Cancel</MdTextButton>
    <MdFilledButton value="delete">
      <MdIcon slot="icon">delete</MdIcon>
      Delete
    </MdFilledButton>
  </div>
</MdDialog>;
```

`MdIcon` needs the Material Symbols font, which the library does not load. Load it once at startup:

```ts
import { ensureMaterialSymbols } from "@aphrody/material-web/icon/material-symbols.js";
ensureMaterialSymbols(); // or { iconNames: ["delete", "search"] } to subset
```

The child text is the glyph name (Material Symbols snake_case). Variable axes are tokens: `--md-icon-fill` (0..1),
`--md-icon-wght` (100..700), `--md-icon-grad`, `--md-icon-opsz`.

## Layout

- `src/index.ts`: re-exports every wrapper (one `export *` per group).
- `src/wrappers/<group>.ts`: one file per `material-web` source folder (`button.ts`, `select.ts`, `labs.ts`, ...). Each
  export:

  ```ts
  export const MdFilledButton = createComponent({
    react: React,
    tagName: "md-filled-button",
    elementClass: MdFilledButtonElement, // from @aphrody/material-web/button/filled-button.js
    events: {}, // real native events (see the table below)
  });
  ```

- `generate.ts`: reads `md-elements.txt`, scans a `material-web` source checkout (`--source <dir>`) to resolve each tag to
  its entry file and exported class (`@customElement('md-x') export class Foo`), applies the verified event table and
  writes `src/wrappers/`, `src/index.ts`, `.manifest.json` and the last section of this README. It prefers the canonical
  path (bundled by `all.ts`, `aphrody-components.ts` or `aphrody-labs.ts`), then non-`labs/gb`, then `labs/gb` (the only
  home of `md-button`, `md-card`, `md-menu-group` and `md-split-button`, whose classes are re-aliased to `Md*`).
- `src/material-web-shims.d.ts`: ambient `*.cssresult.js` and `*.css` modules, see below.

## Mapped events (verified in the Lit sources)

Event names come from `@fires` and `new (Custom)?Event('...')` in `material-web/<dir>/internal/*.ts`. Upstream components
use plain names (`input`, `change`, `opening`, ...); fork components namespace theirs (`paginator:page`, `table:sort`,
`side-sheet:opening`, `tree:select`, ...).

| Element                                                         | React prop to native event                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `MdCheckbox`, `MdRadio`, `MdSwitch`, `MdSlider`, `Md*TextField` | `onChange:change`, `onInput:input`                                        |
| `MdFilledSelect`, `MdOutlinedSelect`                            | `+onOpening/onOpened/onClosing/onClosed`                                  |
| `MdDialog`                                                      | `onOpen:open`, `onOpened`, `onClose:close`, `onClosed`, `onCancel:cancel` |
| `MdMenu`, `MdSubMenu`                                           | `onOpening/onOpened/onClosing/onClosed`                                   |
| `MdMenuItem`                                                    | `onCloseMenu:close-menu`                                                  |
| `MdSnackbar`                                                    | `onOpening/onOpened/onClosing/onClosed` (bare)                            |
| `MdBottomSheet` / `MdSideSheet`                                 | `onOpening:bottom-sheet:opening` ... (fork, namespaced)                   |
| `MdSearchBar`                                                   | `onInput`, `onSearch:search`, `onSearchOpen/onSearchClose`                |
| `MdAutocomplete`                                                | `onInput`, `onSelect:autocomplete:select`                                 |
| `MdNavigationBar`                                               | `onActivated:navigation-bar-activated`                                    |
| `MdNavigationRail`                                              | `onChange:navigation-rail:change`, `onItemActivate`                       |
| `MdNavigationDrawer(Modal)`                                     | `onNavigationDrawerChanged:navigation-drawer-changed`                     |
| `MdInputChip`                                                   | `onRemove:remove`, `onUpdateFocus:update-focus`                           |
| `MdButtonGroup`                                                 | `onChange:button-group:change`                                            |
| `MdFabMenu` / `MdFabMenuItem`                                   | `onOpen/onClose:fab-menu:*`, `onClick:fab-menu-item:click`                |
| `MdExpansionPanel`                                              | `onToggle:expansion:toggle`                                               |
| `MdStepper`                                                     | `onChange:stepper:change`                                                 |
| `MdDatePicker` / `MdTimePicker`                                 | `onChange:date-picker:change` / `time-picker:change`                      |
| `MdTable`                                                       | `onSort:table:sort`, `onSelectionChange:table:selection-change`           |
| `MdPaginator`                                                   | `onPage:paginator:page`                                                   |
| `MdTree` / `MdTreeItem`                                         | `onSelect:tree:select` / `onToggle:tree-item:toggle`, `onActivate`        |
| `MdVirtualScroller`                                             | `onRange:virtual-scroll:range`                                            |
| `MdTooltip`                                                     | `onShow:tooltip-show`, `onHide:tooltip-hide`                              |
| `MdTabs`                                                        | `onChange:change`                                                         |

Presentational elements (`md-icon`, `md-divider`, `md-elevation`, `md-ripple`, `md-focus-ring`, assist/filter/suggestion
chips, cards, fab, buttons, `md-item`, `md-toolbar`, `md-carousel`, `md-accordion`, `md-loading-indicator`, panes and
scaffold) emit no documented event: `events: {}`.

## Type checking

`bun check --noEmit` checks the wrappers and the `material-web` sources they import. The package `tsconfig.json` sets:

1. `experimentalDecorators: true` and `useDefineForClassFields: false`: the fork's Lit elements use legacy decorators.
2. `src/material-web-shims.d.ts`: declares `*.cssresult.js` and `*.css` as ambient modules. They are Sass build artifacts
   absent from a source checkout; the wrappers never touch them, so they are typed `any` (which also avoids the nominal
   clash between `material-web`'s nested `lit@2` and this package's `lit@3`).
3. `moduleResolution: bundler`: resolves bare `@aphrody/material-web/x/y.js` imports.

Against a built `material-web` (with `*.cssresult.js` and `*.css` present) the shims are unnecessary. All 119 tags of
`md-elements.txt` resolve to a real entry file with an exported class.

## All wrappers (119)

> Regenerated by `generate.ts` (`.manifest.json`). 0 unresolved.

| Wrapper                        | Tag                                | Element import                                                                   | # events |
| ------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------- | -------- |
| `Md3dCanvas`                   | `md-3d-canvas`                     | `@aphrody/material-web/canvas3d/canvas-3d.js`                                    | —        |
| `Md3dCard`                     | `md-3d-card`                       | `@aphrody/material-web/card3d/card-3d.js`                                        | —        |
| `Md3dGlobe`                    | `md-3d-globe`                      | `@aphrody/material-web/globe3d/globe-3d.js`                                      | —        |
| `MdAccordion`                  | `md-accordion`                     | `@aphrody/material-web/expansion/accordion.js`                                   | —        |
| `MdAlert`                      | `md-alert`                         | `@aphrody/material-web/alert/alert.js`                                           | 1        |
| `MdAreaChart`                  | `md-area-chart`                    | `@aphrody/material-web/charts/area-chart.js`                                     | —        |
| `MdAssistChip`                 | `md-assist-chip`                   | `@aphrody/material-web/chips/assist-chip.js`                                     | —        |
| `MdAutocomplete`               | `md-autocomplete`                  | `@aphrody/material-web/autocomplete/autocomplete.js`                             | 2        |
| `MdAvatar`                     | `md-avatar`                        | `@aphrody/material-web/avatar/avatar.js`                                         | 1        |
| `MdAvatarGroup`                | `md-avatar-group`                  | `@aphrody/material-web/avatar/avatar-group.js`                                   | —        |
| `MdBackdrop`                   | `md-backdrop`                      | `@aphrody/material-web/backdrop/backdrop.js`                                     | —        |
| `MdBadge`                      | `md-badge`                         | `@aphrody/material-web/badge/badge.js`                                           | —        |
| `MdBarChart`                   | `md-bar-chart`                     | `@aphrody/material-web/charts/bar-chart.js`                                      | —        |
| `MdBottomAppBar`               | `md-bottom-app-bar`                | `@aphrody/material-web/appbar/bottom-app-bar.js`                                 | —        |
| `MdBottomSheet`                | `md-bottom-sheet`                  | `@aphrody/material-web/sheet/bottom-sheet.js`                                    | 4        |
| `MdBrandedFab`                 | `md-branded-fab`                   | `@aphrody/material-web/fab/branded-fab.js`                                       | —        |
| `MdBreadcrumbs`                | `md-breadcrumbs`                   | `@aphrody/material-web/breadcrumbs/breadcrumbs.js`                               | —        |
| `MdButton`                     | `md-button`                        | `@aphrody/material-web/labs/gb/components/button/md-button.js`                   | —        |
| `MdButtonGroup`                | `md-button-group`                  | `@aphrody/material-web/buttongroup/button-group.js`                              | 1        |
| `MdCard`                       | `md-card`                          | `@aphrody/material-web/card/card.js`                                             | —        |
| `MdCarousel`                   | `md-carousel`                      | `@aphrody/material-web/carousel/carousel.js`                                     | 1        |
| `MdCarouselItem`               | `md-carousel-item`                 | `@aphrody/material-web/carousel/carousel-item.js`                                | —        |
| `MdCheckbox`                   | `md-checkbox`                      | `@aphrody/material-web/checkbox/checkbox.js`                                     | 2        |
| `MdChipSet`                    | `md-chip-set`                      | `@aphrody/material-web/chips/chip-set.js`                                        | —        |
| `MdCircularProgress`           | `md-circular-progress`             | `@aphrody/material-web/progress/circular-progress.js`                            | —        |
| `MdDatePicker`                 | `md-date-picker`                   | `@aphrody/material-web/datepicker/date-picker.js`                                | 1        |
| `MdDateRangePicker`            | `md-date-range-picker`             | `@aphrody/material-web/datepicker/date-range-picker.js`                          | 3        |
| `MdDateTimePicker`             | `md-date-time-picker`              | `@aphrody/material-web/datepicker/date-time-picker.js`                           | 3        |
| `MdDialog`                     | `md-dialog`                        | `@aphrody/material-web/dialog/dialog.js`                                         | 5        |
| `MdDivider`                    | `md-divider`                       | `@aphrody/material-web/divider/divider.js`                                       | —        |
| `MdElevatedButton`             | `md-elevated-button`               | `@aphrody/material-web/button/elevated-button.js`                                | —        |
| `MdElevatedCard`               | `md-elevated-card`                 | `@aphrody/material-web/labs/card/elevated-card.js`                               | —        |
| `MdElevation`                  | `md-elevation`                     | `@aphrody/material-web/elevation/elevation.js`                                   | —        |
| `MdExpansionPanel`             | `md-expansion-panel`               | `@aphrody/material-web/expansion/expansion-panel.js`                             | 1        |
| `MdFab`                        | `md-fab`                           | `@aphrody/material-web/fab/fab.js`                                               | —        |
| `MdFabMenu`                    | `md-fab-menu`                      | `@aphrody/material-web/fabmenu/fab-menu.js`                                      | 2        |
| `MdFabMenuItem`                | `md-fab-menu-item`                 | `@aphrody/material-web/fabmenu/fab-menu-item.js`                                 | 1        |
| `MdFilledButton`               | `md-filled-button`                 | `@aphrody/material-web/button/filled-button.js`                                  | —        |
| `MdFilledCard`                 | `md-filled-card`                   | `@aphrody/material-web/labs/card/filled-card.js`                                 | —        |
| `MdFilledField`                | `md-filled-field`                  | `@aphrody/material-web/field/filled-field.js`                                    | —        |
| `MdFilledIconButton`           | `md-filled-icon-button`            | `@aphrody/material-web/iconbutton/filled-icon-button.js`                         | —        |
| `MdFilledSelect`               | `md-filled-select`                 | `@aphrody/material-web/select/filled-select.js`                                  | 6        |
| `MdFilledTextField`            | `md-filled-text-field`             | `@aphrody/material-web/textfield/filled-text-field.js`                           | 2        |
| `MdFilledTonalButton`          | `md-filled-tonal-button`           | `@aphrody/material-web/button/filled-tonal-button.js`                            | —        |
| `MdFilledTonalIconButton`      | `md-filled-tonal-icon-button`      | `@aphrody/material-web/iconbutton/filled-tonal-icon-button.js`                   | —        |
| `MdFilterChip`                 | `md-filter-chip`                   | `@aphrody/material-web/chips/filter-chip.js`                                     | —        |
| `MdFocusRing`                  | `md-focus-ring`                    | `@aphrody/material-web/focus/md-focus-ring.js`                                   | —        |
| `MdGauge`                      | `md-gauge`                         | `@aphrody/material-web/charts/gauge.js`                                          | —        |
| `MdGridList`                   | `md-grid-list`                     | `@aphrody/material-web/gridlist/grid-list.js`                                    | —        |
| `MdGridTile`                   | `md-grid-tile`                     | `@aphrody/material-web/gridlist/grid-tile.js`                                    | —        |
| `MdIcon`                       | `md-icon`                          | `@aphrody/material-web/icon/icon.js`                                             | —        |
| `MdIconButton`                 | `md-icon-button`                   | `@aphrody/material-web/iconbutton/icon-button.js`                                | —        |
| `MdInputChip`                  | `md-input-chip`                    | `@aphrody/material-web/chips/input-chip.js`                                      | 2        |
| `MdItem`                       | `md-item`                          | `@aphrody/material-web/labs/item/item.js`                                        | —        |
| `MdLinearProgress`             | `md-linear-progress`               | `@aphrody/material-web/progress/linear-progress.js`                              | —        |
| `MdLineChart`                  | `md-line-chart`                    | `@aphrody/material-web/charts/line-chart.js`                                     | —        |
| `MdLink`                       | `md-link`                          | `@aphrody/material-web/link/link.js`                                             | —        |
| `MdList`                       | `md-list`                          | `@aphrody/material-web/list/list.js`                                             | —        |
| `MdListDetail`                 | `md-list-detail`                   | `@aphrody/material-web/layout/md-list-detail.js`                                 | —        |
| `MdListItem`                   | `md-list-item`                     | `@aphrody/material-web/list/list-item.js`                                        | —        |
| `MdLoadingIndicator`           | `md-loading-indicator`             | `@aphrody/material-web/loadingindicator/loading-indicator.js`                    | —        |
| `MdMenu`                       | `md-menu`                          | `@aphrody/material-web/menu/menu.js`                                             | 4        |
| `MdMenuGroup`                  | `md-menu-group`                    | `@aphrody/material-web/labs/gb/components/menu/md-menu-group.js`                 | —        |
| `MdMenuItem`                   | `md-menu-item`                     | `@aphrody/material-web/menu/menu-item.js`                                        | 1        |
| `MdMobileStepper`              | `md-mobile-stepper`                | `@aphrody/material-web/mobilestepper/mobile-stepper.js`                          | —        |
| `MdNavigationBar`              | `md-navigation-bar`                | `@aphrody/material-web/labs/navigationbar/navigation-bar.js`                     | 1        |
| `MdNavigationDrawer`           | `md-navigation-drawer`             | `@aphrody/material-web/labs/navigationdrawer/navigation-drawer.js`               | 1        |
| `MdNavigationDrawerModal`      | `md-navigation-drawer-modal`       | `@aphrody/material-web/labs/navigationdrawer/navigation-drawer-modal.js`         | 1        |
| `MdNavigationRail`             | `md-navigation-rail`               | `@aphrody/material-web/navigationrail/navigation-rail.js`                        | 2        |
| `MdNavigationRailItem`         | `md-navigation-rail-item`          | `@aphrody/material-web/navigationrail/navigation-rail-item.js`                   | —        |
| `MdNavigationTab`              | `md-navigation-tab`                | `@aphrody/material-web/labs/navigationtab/navigation-tab.js`                     | —        |
| `MdOutlinedButton`             | `md-outlined-button`               | `@aphrody/material-web/button/outlined-button.js`                                | —        |
| `MdOutlinedCard`               | `md-outlined-card`                 | `@aphrody/material-web/labs/card/outlined-card.js`                               | —        |
| `MdOutlinedField`              | `md-outlined-field`                | `@aphrody/material-web/field/outlined-field.js`                                  | —        |
| `MdOutlinedIconButton`         | `md-outlined-icon-button`          | `@aphrody/material-web/iconbutton/outlined-icon-button.js`                       | —        |
| `MdOutlinedSegmentedButton`    | `md-outlined-segmented-button`     | `@aphrody/material-web/labs/segmentedbutton/outlined-segmented-button.js`        | —        |
| `MdOutlinedSegmentedButtonSet` | `md-outlined-segmented-button-set` | `@aphrody/material-web/labs/segmentedbuttonset/outlined-segmented-button-set.js` | —        |
| `MdOutlinedSelect`             | `md-outlined-select`               | `@aphrody/material-web/select/outlined-select.js`                                | 6        |
| `MdOutlinedTextField`          | `md-outlined-text-field`           | `@aphrody/material-web/textfield/outlined-text-field.js`                         | 2        |
| `MdPaginator`                  | `md-paginator`                     | `@aphrody/material-web/paginator/paginator.js`                                   | 1        |
| `MdPane`                       | `md-pane`                          | `@aphrody/material-web/layout/md-pane.js`                                        | —        |
| `MdPieChart`                   | `md-pie-chart`                     | `@aphrody/material-web/charts/pie-chart.js`                                      | —        |
| `MdPopover`                    | `md-popover`                       | `@aphrody/material-web/popover/popover.js`                                       | 2        |
| `MdPrimaryTab`                 | `md-primary-tab`                   | `@aphrody/material-web/tabs/primary-tab.js`                                      | —        |
| `MdRadarChart`                 | `md-radar-chart`                   | `@aphrody/material-web/charts/radar-chart.js`                                    | —        |
| `MdRadio`                      | `md-radio`                         | `@aphrody/material-web/radio/radio.js`                                           | 2        |
| `MdRating`                     | `md-rating`                        | `@aphrody/material-web/rating/rating.js`                                         | 2        |
| `MdRipple`                     | `md-ripple`                        | `@aphrody/material-web/ripple/ripple.js`                                         | —        |
| `MdScaffold`                   | `md-scaffold`                      | `@aphrody/material-web/layout/md-scaffold.js`                                    | —        |
| `MdScatterChart`               | `md-scatter-chart`                 | `@aphrody/material-web/charts/scatter-chart.js`                                  | —        |
| `MdScheduler`                  | `md-scheduler`                     | `@aphrody/material-web/scheduler/scheduler.js`                                   | 3        |
| `MdSearchBar`                  | `md-search-bar`                    | `@aphrody/material-web/search/search-bar.js`                                     | 4        |
| `MdSecondaryTab`               | `md-secondary-tab`                 | `@aphrody/material-web/tabs/secondary-tab.js`                                    | —        |
| `MdSelectOption`               | `md-select-option`                 | `@aphrody/material-web/select/select-option.js`                                  | —        |
| `MdSideSheet`                  | `md-side-sheet`                    | `@aphrody/material-web/sheet/side-sheet.js`                                      | 4        |
| `MdSkeleton`                   | `md-skeleton`                      | `@aphrody/material-web/skeleton/skeleton.js`                                     | —        |
| `MdSlider`                     | `md-slider`                        | `@aphrody/material-web/slider/slider.js`                                         | 2        |
| `MdSnackbar`                   | `md-snackbar`                      | `@aphrody/material-web/snackbar/snackbar.js`                                     | 4        |
| `MdSparkline`                  | `md-sparkline`                     | `@aphrody/material-web/charts/sparkline.js`                                      | —        |
| `MdSplitButton`                | `md-split-button`                  | `@aphrody/material-web/labs/gb/components/splitbutton/md-split-button.js`        | —        |
| `MdStep`                       | `md-step`                          | `@aphrody/material-web/stepper/step.js`                                          | —        |
| `MdStepper`                    | `md-stepper`                       | `@aphrody/material-web/stepper/stepper.js`                                       | 1        |
| `MdSubMenu`                    | `md-sub-menu`                      | `@aphrody/material-web/menu/sub-menu.js`                                         | 4        |
| `MdSuggestionChip`             | `md-suggestion-chip`               | `@aphrody/material-web/chips/suggestion-chip.js`                                 | —        |
| `MdSupportingPane`             | `md-supporting-pane`               | `@aphrody/material-web/layout/md-supporting-pane.js`                             | —        |
| `MdSurface`                    | `md-surface`                       | `@aphrody/material-web/surface/surface.js`                                       | —        |
| `MdSwitch`                     | `md-switch`                        | `@aphrody/material-web/switch/switch.js`                                         | 2        |
| `MdTable`                      | `md-table`                         | `@aphrody/material-web/table/table.js`                                           | 2        |
| `MdTabs`                       | `md-tabs`                          | `@aphrody/material-web/tabs/tabs.js`                                             | 1        |
| `MdTextButton`                 | `md-text-button`                   | `@aphrody/material-web/button/text-button.js`                                    | —        |
| `MdTimePicker`                 | `md-time-picker`                   | `@aphrody/material-web/timepicker/time-picker.js`                                | 1        |
| `MdToolbar`                    | `md-toolbar`                       | `@aphrody/material-web/toolbar/md-toolbar.js`                                    | —        |
| `MdTooltip`                    | `md-tooltip`                       | `@aphrody/material-web/tooltip/tooltip.js`                                       | 2        |
| `MdTopAppBar`                  | `md-top-app-bar`                   | `@aphrody/material-web/appbar/top-app-bar.js`                                    | —        |
| `MdTree`                       | `md-tree`                          | `@aphrody/material-web/tree/tree.js`                                             | 1        |
| `MdTreeItem`                   | `md-tree-item`                     | `@aphrody/material-web/tree/tree-item.js`                                        | 2        |
| `MdType`                       | `md-type`                          | `@aphrody/material-web/typography/md-type.js`                                    | —        |
| `MdVirtualScroller`            | `md-virtual-scroller`              | `@aphrody/material-web/virtualscroll/virtual-scroller.js`                        | 1        |
| `MdWebgpuCanvas`               | `md-webgpu-canvas`                 | `@aphrody/material-web/effects/webgpu-canvas.js`                                 | —        |
