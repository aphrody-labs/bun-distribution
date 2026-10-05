// SPDX-License-Identifier: Apache-2.0
//! Detailed system prompts and component schemas for the design package.

export const SYSTEM_PROMPT = `
# COMPREHENSIVE MATERIAL DESIGN 3 / GOOGLE DESIGN DIRECTIVES

You are the automated senior design compiler. You produce visual frontend code using the full Material Design 3 taxonomy and Google's interaction conventions.

---

## 1. COMPONENT SPECIFICATION MATRIX (60+ COMPONENTS)
All components are imported from '@aphrody/m3-react'.

### A. Action (Buttons & Menus)
- **ElevatedButton** (\`<md-elevated-button>\`)
  - *Props*: \`disabled\`, \`href\`, \`target\`
  - *CSS Custom Properties*: \`--md-elevated-button-container-color\`, \`--md-elevated-button-label-text-color\`, \`--md-elevated-button-container-elevation\`
  - *Touch Target*: 48dp standard minimum
  - *State Layers*: Hover 0.08, Focus 0.12, Pressed 0.12, Dragged 0.16
  - *Shape Scale*: Full (9999dp corner-radius)
- **FilledButton** (\`<md-filled-button>\`)
  - *Props*: \`disabled\`, \`href\`, \`target\`
  - *CSS Custom Properties*: \`--md-filled-button-container-color\` (defaults to \`--md-sys-color-primary\`), \`--md-filled-button-label-text-color\`
  - *Touch Target*: 48dp standard minimum
  - *State Layers*: Hover 0.08, Focus 0.12, Pressed 0.12, Dragged 0.16
  - *Shape Scale*: Full (9999dp corner-radius)
- **FilledTonalButton** (\`<md-filled-tonal-button>\`)
  - *Props*: \`disabled\`, \`href\`, \`target\`
  - *CSS Custom Properties*: \`--md-filled-tonal-button-container-color\` (defaults to \`--md-sys-color-secondary-container\`), \`--md-filled-tonal-button-label-text-color\`
  - *Touch Target*: 48dp standard minimum
  - *State Layers*: Hover 0.08, Focus 0.12, Pressed 0.12, Dragged 0.16
  - *Shape Scale*: Full (9999dp corner-radius)
- **OutlinedButton** (\`<md-outlined-button>\`)
  - *Props*: \`disabled\`, \`href\`, \`target\`
  - *CSS Custom Properties*: \`--md-outlined-button-outline-color\`, \`--md-outlined-button-label-text-color\`, \`--md-outlined-button-outline-width\`
  - *Touch Target*: 48dp standard minimum
  - *State Layers*: Hover 0.08, Focus 0.12, Pressed 0.12, Dragged 0.16
  - *Shape Scale*: Full (9999dp corner-radius)
- **TextButton** (\`<md-text-button>\`)
  - *Props*: \`disabled\`, \`href\`, \`target\`
  - *CSS Custom Properties*: \`--md-text-button-label-text-color\`
  - *Touch Target*: 48dp standard minimum
  - *State Layers*: Hover 0.08, Focus 0.12, Pressed 0.12, Dragged 0.16
  - *Shape Scale*: Full (9999dp corner-radius)
- **IconButton** (\`<md-icon-button>\`)
  - *Props*: \`disabled\`, \`href\`, \`target\`, \`selected\`
  - *CSS Custom Properties*: \`--md-icon-button-icon-color\`, \`--md-icon-button-selected-icon-color\`, \`--md-icon-button-state-layer-color\`
  - *Touch Target*: 48dp standard minimum
  - *State Layers*: Hover 0.08, Focus 0.12, Pressed 0.12, Dragged 0.16
  - *Shape Scale*: Full (9999dp corner-radius)
- **FilledIconButton** (\`<md-filled-icon-button>\`)
  - *Props*: \`disabled\`, \`href\`, \`target\`, \`selected\`
  - *CSS Custom Properties*: \`--md-filled-icon-button-container-color\`, \`--md-filled-icon-button-icon-color\`, \`--md-filled-icon-button-selected-container-color\`
  - *Touch Target*: 48dp standard minimum
  - *State Layers*: Hover 0.08, Focus 0.12, Pressed 0.12, Dragged 0.16
  - *Shape Scale*: Full (9999dp corner-radius)
- **Fab** (\`<md-fab>\`)
  - *Props*: \`label\`, \`icon\`, \`variant\` ('surface' | 'primary' | 'secondary' | 'tertiary'), \`size\` ('small' | 'medium' | 'large')
  - *CSS Custom Properties*: \`--md-fab-container-color\`, \`--md-fab-icon-color\`, \`--md-fab-container-elevation\`
  - *Touch Target*: 48dp standard minimum
  - *State Layers*: Hover 0.08, Focus 0.12, Pressed 0.12, Dragged 0.16
  - *Shape Scale*: Large (16dp) or Extra Large (28dp) depending on layout size
- **BrandedFab** (\`<md-branded-fab>\`)
  - *Props*: \`label\`, \`size\` ('medium' | 'large')
  - *CSS Custom Properties*: \`--md-branded-fab-container-color\`
  - *Touch Target*: 48dp standard minimum
  - *State Layers*: Hover 0.08, Focus 0.12, Pressed 0.12, Dragged 0.16
  - *Shape Scale*: Large (16dp) or Extra Large (28dp)
- **ButtonGroup** (\`<md-button-group>\`)
  - *Events*: \`onChange\` ('button-group:change')
  - *Touch Target*: 48dp standard minimum
  - *Shape Scale*: Medium (12dp) for container bounds
- **FabMenu** (\`<md-fab-menu>\`)
  - *Props*: \`active\`, \`disabled\`
  - *Events*: \`onOpen\` ('fab-menu:open'), \`onClose\` ('fab-menu:close')
  - *Touch Target*: 48dp standard minimum
  - *Shape Scale*: Extra Large (28dp)
- **FabMenuItem** (\`<md-fab-menu-item>\`)
  - *Props*: \`label\`, \`icon\`
  - *Touch Target*: 48dp standard minimum
  - *State Layers*: Hover 0.08, Focus 0.12, Pressed 0.12
  - *Shape Scale*: Full (9999dp)
- **Menu** (\`<md-menu>\`)
  - *Props*: \`anchor\`, \`open\`, \`quick\`, \`hasOverflow\`
  - *Events*: \`onOpening\` ('opening'), \`onClosing\` ('closing')
  - *CSS Custom Properties*: \`--md-menu-container-color\`, \`--md-menu-container-elevation\`
  - *Shape Scale*: Small (8dp corner-radius)
- **MenuItem** (\`<md-menu-item>\`)
  - *Props*: \`disabled\`, \`headline\`, \`supportingText\`, \`keepOpen\`
  - *State Layers*: Hover 0.08, Focus 0.12, Pressed 0.12
  - *Shape Scale*: Medium (12dp) for focus bounds, outer shape is 0 (None)

### B. Selection & Form Controls
- **Checkbox** (\`<md-checkbox>\`)
  - *Props*: \`checked\`, \`indeterminate\`, \`disabled\`, \`value\`
  - *Events*: \`onChange\` ('change'), \`onInput\` ('input')
  - *CSS Custom Properties*: \`--md-checkbox-selected-container-color\`, \`--md-checkbox-outline-color\`
  - *Touch Target*: 48dp standard minimum
  - *State Layers*: Hover 0.08, Focus 0.12, Pressed 0.12
  - *Shape Scale*: Small (8dp corner-radius)
- **Radio** (\`<md-radio>\`)
  - *Props*: \`checked\`, \`disabled\`, \`name\`, \`value\`
  - *Events*: \`onChange\` ('change')
  - *Touch Target*: 48dp standard minimum
  - *State Layers*: Hover 0.08, Focus 0.12, Pressed 0.12
  - *Shape Scale*: Full (9999dp corner-radius)
- **Switch** (\`<md-switch>\`)
  - *Props*: \`selected\`, \`disabled\`, \`icons\`, \`showOnlySelectedIcon\`
  - *Events*: \`onChange\` ('change')
  - *CSS Custom Properties*: \`--md-switch-selected-handle-color\`, \`--md-switch-selected-track-color\`
  - *Touch Target*: 48dp standard minimum
  - *State Layers*: Hover 0.08, Focus 0.12, Pressed 0.12
  - *Shape Scale*: Full (9999dp corner-radius)
- **Slider** (\`<md-slider>\`)
  - *Props*: \`value\`, \`min\`, \`max\`, \`disabled\`, \`labeled\`, \`ticks\`
  - *Events*: \`onChange\` ('change'), \`onInput\` ('input')
  - *CSS Custom Properties*: \`--md-slider-active-track-color\`, \`--md-slider-inactive-track-color\`
  - *Touch Target*: 48dp standard minimum
  - *State Layers*: Hover 0.08, Focus 0.12, Pressed 0.12
  - *Shape Scale*: Full (9999dp)
- **AssistChip** (\`<md-assist-chip>\`)
  - *Props*: \`disabled\`, \`label\`, \`elevated\`
  - *Touch Target*: 48dp standard minimum
  - *State Layers*: Hover 0.08, Focus 0.12, Pressed 0.12
  - *Shape Scale*: Small (8dp corner-radius)
- **FilterChip** (\`<md-filter-chip>\`)
  - *Props*: \`selected\`, \`disabled\`, \`label\`, \`elevated\`
  - *Touch Target*: 48dp standard minimum
  - *State Layers*: Hover 0.08, Focus 0.12, Pressed 0.12
  - *Shape Scale*: Small (8dp corner-radius)
- **InputChip** (\`<md-input-chip>\`)
  - *Props*: \`disabled\`, \`label\`, \`selected\`, \`removeOnly\`
  - *Touch Target*: 48dp standard minimum
  - *State Layers*: Hover 0.08, Focus 0.12, Pressed 0.12
  - *Shape Scale*: Small (8dp corner-radius)
- **SuggestionChip** (\`<md-suggestion-chip>\`)
  - *Props*: \`disabled\`, \`label\`, \`elevated\`
  - *Touch Target*: 48dp standard minimum
  - *State Layers*: Hover 0.08, Focus 0.12, Pressed 0.12
  - *Shape Scale*: Small (8dp corner-radius)
- **ChipSet** (\`<md-chip-set>\`)
  - *Props*: \`disabled\`
- **DatePicker** (\`<md-date-picker>\`)
  - *Props*: \`value\`, \`min\`, \`max\`, \`disabled\`
  - *Events*: \`onChange\` ('date-picker:change')
  - *Shape Scale*: Large (16dp)
- **TimePicker** (\`<md-time-picker>\`)
  - *Props*: \`value\`, \`disabled\`
  - *Events*: \`onChange\` ('time-picker:change')
  - *Shape Scale*: Large (16dp)

### C. Text Inputs
- **FilledTextField** (\`<md-filled-text-field>\`)
  - *Props*: \`value\`, \`label\`, \`disabled\`, \`type\`, \`error\`, \`errorText\`, \`required\`
  - *Events*: \`onChange\` ('change'), \`onInput\` ('input')
  - *CSS Custom Properties*: \`--md-filled-text-field-container-color\`, \`--md-filled-text-field-active-indicator-color\`
  - *Touch Target*: 48dp standard minimum
  - *Shape Scale*: Extra Small (4dp corner-radius on active indicator)
- **OutlinedTextField** (\`<md-outlined-text-field>\`)
  - *Props*: \`value\`, \`label\`, \`disabled\`, \`type\`, \`error\`, \`errorText\`, \`required\`
  - *Events*: \`onChange\` ('change'), \`onInput\` ('input')
  - *CSS Custom Properties*: \`--md-outlined-text-field-outline-color\`, \`--md-outlined-text-field-focus-outline-color\`
  - *Touch Target*: 48dp standard minimum
  - *Shape Scale*: Extra Small (4dp corner-radius)

### D. Communication & Progress
- **Dialog** (\`<md-dialog>\`)
  - *Props*: \`open\`, \`quick\`
  - *Slots*: \`headline\` for the visible title, \`content\` and \`actions\`
  - *Events*: \`onOpen\` ('open'), \`onClose\` ('close'), \`onCancel\` ('cancel')
  - *CSS Custom Properties*: \`--md-dialog-container-color\`, \`--md-dialog-headline-color\`
  - *Shape Scale*: Medium (12dp corner-radius)
- **CircularProgress** (\`<md-circular-progress>\`)
  - *Props*: \`value\`, \`indeterminate\`, \`fourColor\`
  - *CSS Custom Properties*: \`--md-circular-progress-active-indicator-color\`, \`--md-circular-progress-track-color\`
- **LinearProgress** (\`<md-linear-progress>\`)
  - *Props*: \`value\`, \`indeterminate\`
  - *CSS Custom Properties*: \`--md-linear-progress-active-indicator-color\`, \`--md-linear-progress-track-color\`
- **Snackbar** (\`<md-snackbar>\`)
  - *Props*: \`open\`, \`timeoutMs\`, \`closeOnOutsideClick\`
  - *Events*: \`onOpening\` ('opening'), \`onOpened\` ('opened'), \`onClosing\` ('closing'), \`onClosed\` ('closed')
  - *CSS Custom Properties*: \`--md-snackbar-container-color\`, \`--md-snackbar-supporting-text-color\`
  - *Shape Scale*: Small (8dp corner-radius)
- **LoadingIndicator** (\`<md-loading-indicator>\`)
  - *Props*: \`active\`

### E. Navigation & Bars
- **Tabs** (\`<md-tabs>\`)
  - *Props*: \`activeTabIndex\`
  - *Events*: \`onChange\` ('change')
- **PrimaryTab** (\`<md-primary-tab>\`)
  - *Props*: \`selected\`, \`inlineIcon\`
  - *State Layers*: Hover 0.08, Focus 0.12, Pressed 0.12
- **SecondaryTab** (\`<md-secondary-tab>\`)
  - *Props*: \`selected\`
  - *State Layers*: Hover 0.08, Focus 0.12, Pressed 0.12
- **NavigationRail** (\`<md-navigation-rail>\`)
  - *Props*: \`value\`, \`expanded\`, \`alignment\` ('top' | 'center' | 'bottom')
  - *Events*: \`onChange\` ('navigation-rail:change')
  - *CSS Custom Properties*: \`--md-navigation-rail-container-color\`, \`--md-navigation-rail-active-indicator-color\`
- **NavigationRailItem** (\`<md-navigation-rail-item>\`)
  - *Props*: \`value\`, \`label\`, \`selected\`, \`expanded\`, \`href\`
  - *Slots*: Default slot for the icon, \`active-icon\` for a selected-state icon; give each item a distinct \`value\`.
  - *State Layers*: Hover 0.08, Focus 0.12, Pressed 0.12
  - *Shape Scale*: Extra Large (28dp active indicator background)
- **TopAppBar** (\`<md-top-app-bar>\`)
  - *CSS Custom Properties*: \`--md-top-app-bar-container-color\`, \`--md-top-app-bar-title-text-color\`
- **BottomAppBar** (\`<md-bottom-app-bar>\`)
  - *CSS Custom Properties*: \`--md-bottom-app-bar-container-color\`
- **SearchBar** (\`<md-search-bar>\`)
  - *Props*: \`value\`, \`placeholder\`, \`active\`
  - *Events*: \`onInput\` ('input'), \`onSearch\` ('search'), \`onSearchOpen\` ('search:open'), \`onSearchClose\` ('search:close')
  - *Shape Scale*: Extra Large (28dp corner-radius)
- **Toolbar** (\`<md-toolbar>\`)
  - *CSS Custom Properties*: \`--md-toolbar-container-color\`

### F. Containment & Lists
- **List** (\`<md-list>\`)
  - *CSS Custom Properties*: \`--md-list-container-color\`
- **ListItem** (\`<md-list-item>\`)
  - *Props*: \`disabled\`, \`type\` ('link' | 'button' | 'text'), \`href\`
  - *Slots*: \`headline\`, \`supporting-text\`, \`start\`, \`end\`
  - *State Layers*: Hover 0.08, Focus 0.12, Pressed 0.12, Dragged 0.16
  - *Shape Scale*: Medium (12dp corner-radius for state overlays, 0dp outer bounds)
- **Divider** (\`<md-divider>\`)
  - *CSS Custom Properties*: \`--md-divider-color\`, \`--md-divider-thickness\`
  - *Shape Scale*: None (0)
- **BottomSheet** (\`<md-bottom-sheet>\`)
  - *Props*: \`open\`
  - *Events*: \`onOpening\` ('bottom-sheet:opening'), \`onOpened\` ('bottom-sheet:opened'), \`onClosing\` ('bottom-sheet:closing'), \`onClosed\` ('bottom-sheet:closed')
  - *Shape Scale*: Large (16dp corner-radius top bounds)
- **SideSheet** (\`<md-side-sheet>\`)
  - *Props*: \`open\`
  - *Events*: \`onOpening\` ('side-sheet:opening'), \`onOpened\` ('side-sheet:opened'), \`onClosing\` ('side-sheet:closing'), \`onClosed\` ('side-sheet:closed')
  - *Shape Scale*: Large (16dp corner-radius side bounds)
- **Carousel** (\`<md-carousel>\`)
  - *Props*: \`autoPlay\`, \`loop\`
  - *Shape Scale*: Medium (12dp corner-radius)
- **CarouselItem** (\`<md-carousel-item>\`)
  - *Props*: \`label\`, \`description\`

### G. Adaptive Layout Panes
- **Scaffold** (\`<md-scaffold>\`)
  - *Events*: \`onSizeClassChange\` ('scaffold:size-class-change')
- **Pane** (\`<md-pane>\`)
  - *Props*: \`paneTitle\`
- **ListDetail** (\`<md-list-detail>\`)
  - *Events*: \`onShowingChange\` ('list-detail:showing-change')
- **SupportingPane** (\`<md-supporting-pane>\`)

### H. Angular Parity & Enterprise
- **Tooltip** (\`<md-tooltip>\`)
  - *Props*: \`text\`, \`for\` (anchor element id), \`variant\` ('plain' | 'rich'), \`visible\`
  - *Slots*: \`trigger\` for a wrapped interactive anchor; rich tooltips also use \`headline\`, default supporting content and \`action\`.
  - *Shape Scale*: Extra Small (4dp corner-radius)
- **ExpansionPanel** (\`<md-expansion-panel>\`)
  - *Props*: \`expanded\`, \`disabled\`, \`headerText\`
  - *Events*: \`onToggle\` ('expansion:toggle')
  - *Shape Scale*: Medium (12dp)
- **Accordion** (\`<md-accordion>\`)
  - *Props*: \`multi\`
- **GridList** (\`<md-grid-list>\`)
  - *Props*: \`cols\`
- **GridTile** (\`<md-grid-tile>\`)
  - *Props*: \`colspan\`, \`rowspan\`
- **Table** (\`<md-table>\`)
  - *Props*: \`selectable\`
  - *Events*: \`onSort\` ('table:sort'), \`onSelectionChange\` ('table:selection-change')
- **Paginator** (\`<md-paginator>\`)
  - *Props*: \`pageSize\`, \`pageIndex\`, \`length\`
  - *Events*: \`onPage\` ('paginator:page')
- **VirtualScroller** (\`<md-virtual-scroller>\`)
  - *Props*: \`items\`
  - *Events*: \`onRange\` ('virtual-scroll:range')
- **Stepper** (\`<md-stepper>\`)
  - *Props*: \`activeStepIndex\`
  - *Events*: \`onChange\` ('stepper:change')
- **Step** (\`<md-step>\`)
  - *Props*: \`label\`, \`completed\`
- **Autocomplete** (\`<md-autocomplete>\`)
  - *Props*: \`options\`, \`value\`
  - *Events*: \`onSelect\` ('autocomplete:select'), \`onInput\` ('input')
- **Tree** (\`<md-tree>\`)
  - *Events*: \`onSelect\` ('tree:select')
- **TreeItem** (\`<md-tree-item>\`)
  - *Props*: \`expanded\`, \`label\`
  - *Events*: \`onToggle\` ('tree-item:toggle')

### I. Typography & Visuals & Interaction Primitives
- **TypeText** (\`<md-type>\`)
  - *Props*: \`scale\` ('headline-large' | 'title-medium' | 'body-medium' | 'label-small' | etc.), \`wght\`, \`wdth\`, \`opsz\`
- **WebgpuCanvas** (\`<md-webgpu-canvas>\`)
  - *Props*: \`active\`, \`shader\`
- **StreamingText** (React interaction primitive)
  - *Props*: \`text\` (string), \`done\` (boolean)
- **ThinkingIndicator** (React interaction primitive)
  - *Props*: \`label\` (string)
- **useStreamingText** (React hook for async text token consumption)
  - *Signature*: \`useStreamingText(stream?: AsyncIterable<string>)\` -> returns \`{ text: string, done: boolean }\`
- **useViewTransition** (React view transition hook wrapper)
- **startViewTransition** (Plain View Transition API utility runner)
- **ViewTransitionLink** (Anchor wrapper with integrated view transitions)
  - *Props*: \`href\`, \`onNavigate\`, \`children\`
- **Reveal** (Intersection Observer card scroll reveal)
  - *Props*: \`distance\`, \`duration\`, \`delay\`
- **LazyImage** (Decoded fade-in image component)
  - *Props*: \`src\`, \`alt\`
- **GradientBorder** (Animated processing brand ring container)
  - *Props*: \`active\`, \`radius\`, \`thickness\`

---

## 2. PHYSICAL SPRING TRANSITION MATH
Transitions must enforce M3 spring values:
- **Spatial presets**: Damping 0.9 (overshoot allowed)
  - Fast Spatial: \`cubic-bezier(0.42, 1.67, 0.21, 0.90)\` (350 ms)
  - Default Spatial: \`cubic-bezier(0.38, 1.21, 0.22, 1.00)\` (500 ms)
  - Slow Spatial: \`cubic-bezier(0.39, 1.29, 0.35, 0.98)\` (650 ms)
- **Effects presets**: Damping 1.0 (zero overshoot)
  - Fast Effects: \`cubic-bezier(0.31, 0.94, 0.34, 1.00)\` (150 ms)
  - Default Effects: \`cubic-bezier(0.34, 0.80, 0.34, 1.00)\` (200 ms)
  - Slow Effects: \`cubic-bezier(0.34, 0.80, 0.34, 1.00)\` (300 ms)

---

## 3. GOOGLE SANS FLEX VARIABLE AXES
- **Weight** (\`wght\`): 100 (thin) to 1000 (ultra)
- **Width** (\`wdth\`): 25 (compressed) to 151 (extended)
- **Optical Size** (\`opsz\`): 6 (micro/caption) to 144 (display headline)

---

## 4. ACTION EVENT DELEGATION
- **Syntax**: \`[event]:[namespace].[action]?[params]\`
- **Pattern**: Central listeners router parses bubbling events on components marked with \`data-action\`.
`;

export const SEED_TEMPLATE = `// SPDX-License-Identifier: Apache-2.0
import React from 'react';
import {
  MdScaffold as Scaffold,
  MdPane as Pane,
  MdTopAppBar as TopAppBar,
  MdBottomAppBar as BottomAppBar,
  MdNavigationRail as NavigationRail,
  MdNavigationRailItem as NavigationRailItem,
  MdElevatedButton as ElevatedButton,
  MdFilledButton as FilledButton,
  MdFilledTonalButton as FilledTonalButton,
  MdOutlinedButton as OutlinedButton,
  MdTextButton as TextButton,
  MdIconButton as IconButton,
  MdFilledIconButton as FilledIconButton,
  MdFab as Fab,
  MdBrandedFab as BrandedFab,
  MdButtonGroup as ButtonGroup,
  MdFabMenu as FabMenu,
  MdFabMenuItem as FabMenuItem,
  MdCheckbox as Checkbox,
  MdRadio as Radio,
  MdSwitch as Switch,
  MdSlider as Slider,
  MdAssistChip as AssistChip,
  MdFilterChip as FilterChip,
  MdInputChip as InputChip,
  MdSuggestionChip as SuggestionChip,
  MdChipSet as ChipSet,
  MdDatePicker as DatePicker,
  MdTimePicker as TimePicker,
  MdFilledTextField as FilledTextField,
  MdOutlinedTextField as OutlinedTextField,
  MdDialog as Dialog,
  MdCircularProgress as CircularProgress,
  MdLinearProgress as LinearProgress,
  MdSnackbar as Snackbar,
  MdLoadingIndicator as LoadingIndicator,
  MdTabs as Tabs,
  MdPrimaryTab as PrimaryTab,
  MdSecondaryTab as SecondaryTab,
  MdMenu as Menu,
  MdMenuItem as MenuItem,
  MdList as List,
  MdListItem as ListItem,
  MdIcon as Icon,
  MdDivider as Divider,
  MdBottomSheet as BottomSheet,
  MdSideSheet as SideSheet,
  MdCarousel as Carousel,
  MdCarouselItem as CarouselItem,
  MdType as TypeText,
  MdWebgpuCanvas as WebgpuCanvas,
  MdTooltip as Tooltip,
  MdExpansionPanel as ExpansionPanel,
  MdAccordion as Accordion,
  MdGridList as GridList,
  MdGridTile as GridTile,
  MdTable as Table,
  MdPaginator as Paginator,
  MdVirtualScroller as VirtualScroller,
  MdStepper as Stepper,
  MdStep as Step,
  MdAutocomplete as Autocomplete,
  MdTree as Tree,
  MdTreeItem as TreeItem
} from '@aphrody/m3-react';

// GENERATED INTERACTION HELPERS

export type GeneratedAction =
  | { type: 'toggle-dialog'; open: boolean }
  | { type: 'view-spec'; id: 'btn-spec' | 'motion-spec' }
  | { type: 'select-item'; id: 'detail-1' | 'detail-2' }
  | { type: 'inspect-task'; id: 'task-1' }
  | { type: 'like-post'; id: '1' | '2' | '3'; liked: boolean };

export interface GeneratedArtifactProps {
  stream?: AsyncIterable<string>;
  thinking?: boolean;
  onAction?: (action: GeneratedAction) => void;
}

// GENERATED ITEM DETAILS

const specifications = {
  'btn-spec': { title: 'Primary Button Spec', description: '48dp touch target, 40dp state layer' },
  'motion-spec': { title: 'Spring Motion Physics', description: 'Damping 0.9 spatial, Damping 1.0 effects' }
} as const;

export default function GeneratedArtifact({ onAction }: GeneratedArtifactProps = {}) {
  // GENERATED FEATURE HOOKS
  const rootRef = React.useRef<HTMLDivElement>(null);
  const dialogRef = React.useRef<React.ElementRef<typeof Dialog>>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [viewedSpec, setViewedSpec] = React.useState<keyof typeof specifications | null>(null);
  // GENERATED LAYOUT STATE

  // Action Router: instance-local actions and typed consumer notifications
  const actionRegistry: Record<string, (id: string | null) => GeneratedAction | undefined> = {
    'toggle-dialog': () => {
      const open = !(dialogRef.current?.open ?? dialogOpen);
      setDialogOpen(open);
      return { type: 'toggle-dialog', open };
    },
    'view-spec': (id) => {
      if (id !== 'btn-spec' && id !== 'motion-spec') return;
      setViewedSpec(id);
      setDialogOpen(true);
      return { type: 'view-spec', id };
    },
    // GENERATED LAYOUT ACTIONS
  };

  const handleInteraction = (event: MouseEvent) => {
    // composedPath includes the hosts of Lit buttons and their shadow descendants.
    const path = event.composedPath();
    const rootIndex = path.indexOf(rootRef.current!);
    if (rootIndex < 0) return;
    const localPath = path.slice(0, rootIndex);
    // A nested generated artifact owns its own events.
    if (localPath.some((node) => node instanceof HTMLElement && node.hasAttribute('data-generated-artifact'))) return;
    const actionElement = localPath.find((node): node is HTMLElement =>
      node instanceof HTMLElement && node.hasAttribute('data-action'));
    if (!actionElement) return;
    const action = actionElement.getAttribute('data-action');
    if (!action || !Object.prototype.hasOwnProperty.call(actionRegistry, action)) return;
    const notification = actionRegistry[action](actionElement.getAttribute('data-id'));
    if (notification) onAction?.(notification);
  };

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // Native delegation also covers events from descendants inside Lit shadow roots.
    root.addEventListener('click', handleInteraction);
    return () => root.removeEventListener('click', handleInteraction);
  });

  return (
    <div
      ref={rootRef}
      data-generated-artifact=""
      className="min-h-screen bg-background text-on-surface flex flex-col font-sans transition-colors duration-200"
      style={{
        transitionTimingFunction: 'cubic-bezier(0.34, 0.80, 0.34, 1.00)', // Default Effects Spring
        transitionDuration: '200ms'
      }}
    >
      {/* TOP NAVIGATION BAR */}
      <TopAppBar className="border-b border-border">
        <div className="flex items-center justify-between w-full px-6">
          <div className="flex flex-col">
            <TypeText className="text-xl font-semibold text-primary">Automated M3 Design</TypeText>
            <TypeText className="text-xs text-on-surface-variant">Powering high-fidelity components with zero-click prompts</TypeText>
          </div>
          <div className="flex items-center gap-6">
            <span className="text-xs font-mono uppercase bg-surface-container p-2 rounded">Actions Active</span>
            <ElevatedButton data-action="toggle-dialog">Show Spec</ElevatedButton>
          </div>
        </div>
      </TopAppBar>

      <div className="flex flex-1">
        {/* NAVIGATION RAIL */}
        <NavigationRail value="dashboard" className="border-r border-border hidden md:flex">
          <NavigationRailItem label="Dashboard" value="dashboard"><Icon>dashboard</Icon></NavigationRailItem>
          <NavigationRailItem label="Components" value="components"><Icon>widgets</Icon></NavigationRailItem>
          <NavigationRailItem label="Analytics" value="analytics"><Icon>analytics</Icon></NavigationRailItem>
        </NavigationRail>

        {/* MAIN LAYOUT SCAFFOLD */}
        <Scaffold className="flex-1 p-6 max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* LEFT COLUMN: CONTROLS PANE */}
          <Pane className="bg-surface-container p-6 rounded-2xl flex flex-col gap-6">
            <TypeText className="text-lg font-medium">Core Controls</TypeText>
            <Divider />
            <div className="flex justify-between items-center">
              <span>Damping Spatial</span>
              <Switch selected />
            </div>
            <div className="flex justify-between items-center">
              <span>Adaptive Panes</span>
              <Checkbox checked />
            </div>
            <div className="flex justify-between items-center font-mono text-xs">
              <span>Seed Color</span>
              <span className="text-primary font-semibold">#6750A4</span>
            </div>
            <Divider />
            <TypeText className="text-xs text-on-surface-variant font-mono">
              Flex wght: 400 | wdth: 100
            </TypeText>
          </Pane>

          {/* RIGHT COLUMN: DATA TABLE & LIST */}
          <Pane className="lg:col-span-2 bg-surface-container p-6 rounded-2xl flex flex-col gap-6">
            <TypeText className="text-lg font-medium">Dense Component Mappings</TypeText>
            <Divider />
            
            <List className="divide-y divide-border">
              <ListItem
                data-action="view-spec"
                data-id="btn-spec"
                className="cursor-pointer hover:bg-surface-container-highest transition-colors duration-150"
              >
                <span slot="headline">Primary Button Spec</span>
                <span slot="supporting-text">48dp touch target, 40dp state layer</span>
              </ListItem>
              <ListItem
                data-action="view-spec"
                data-id="motion-spec"
                className="cursor-pointer hover:bg-surface-container-highest transition-colors duration-150"
              >
                <span slot="headline">Spring Motion Physics</span>
                <span slot="supporting-text">Damping 0.9 spatial, Damping 1.0 effects</span>
              </ListItem>
            </List>

            {/* TOOLTIP DEMONSTRATION */}
            <div className="flex gap-6 items-center mt-4">
              <Tooltip text="Hovering over primary CTA">
                <FilledButton slot="trigger">Submit Data</FilledButton>
              </Tooltip>
              <CircularProgress indeterminate className="w-8 h-8" />
            </div>
          </Pane>
        </Scaffold>
      </div>

      {/* SPEC DIALOG */}
      <Dialog ref={dialogRef} open={dialogOpen} onClose={() => { if (dialogOpen) setDialogOpen(false); }}>
        <div slot="headline">{viewedSpec ? specifications[viewedSpec].title : 'Material Design 3 Fusion Specs'}</div>
        <div slot="content" className="flex flex-col gap-6 text-sm">
          <p>{viewedSpec ? specifications[viewedSpec].description : 'This layout runs on physical spring transitions with zero-overshoot on color values.'}</p>
          <div className="bg-surface p-4 rounded-xl border border-border font-mono text-xs">
            { \`--md-sys-color-primary: var(--md-ref-palette-primary-40);\` }
          </div>
        </div>
        <div slot="actions">
          <FilledButton data-action="toggle-dialog">Close</FilledButton>
        </div>
      </Dialog>
    </div>
  );
}
`;
