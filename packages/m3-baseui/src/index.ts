// SPDX-License-Identifier: Apache-2.0
// Material 3 for Base UI (`@base-ui/react`, the aphrody-labs fork in packages/base-ui): every Base UI primitive with its
// M3 classes. Behaviour, accessibility and the `data-*` state attributes stay Base UI's; the appearance is the
// stylesheet (`@aphrody/m3-baseui/m3-baseui.css`, or one `css/<name>.css` per component) driven by `--md-sys-*` tokens.
//
// Single-element primitives are components (`M3Button`, `M3Input`); multi-part primitives are namespaces that mirror
// Base UI (`M3Dialog.Root`, `M3Select.Item`); `M3Switch`, `M3Checkbox` and `M3Radio` are the closed forms of their
// parts. Every wrapper module is a `'use client'` boundary, so Server Components can render them with plain props.
// Import from here for convenience or from `@aphrody/m3-baseui/<name>` to name the module; both tree-shake.
export { cx, mergeClassName, part } from "./part";

export {
  BUTTON_SIZES,
  BUTTON_VARIANTS,
  M3Button,
  type ButtonSize,
  type ButtonVariant,
  type M3ButtonProps,
} from "./button";
export {
  M3Checkbox,
  Indicator as M3CheckboxIndicator,
  Root as M3CheckboxRoot,
  type M3CheckboxProps,
} from "./checkbox";
export { M3CheckboxGroup } from "./checkbox-group";
export { M3Form } from "./form";
export { INPUT_VARIANTS, M3Input, type InputVariant, type M3InputProps } from "./input";
export { M3Menubar } from "./menubar";
export {
  M3Radio,
  Indicator as M3RadioIndicator,
  Root as M3RadioRoot,
  type M3RadioProps,
} from "./radio";
export { M3RadioGroup } from "./radio-group";
export { M3Separator } from "./separator";
export {
  M3Switch,
  Root as M3SwitchRoot,
  Thumb as M3SwitchThumb,
  type M3SwitchProps,
} from "./switch";
export { M3Toggle } from "./toggle";
export { M3ToggleGroup } from "./toggle-group";

export * as M3Accordion from "./accordion";
export * as M3AlertDialog from "./alert-dialog";
export * as M3Autocomplete from "./autocomplete";
export * as M3Avatar from "./avatar";
export * as M3Collapsible from "./collapsible";
export * as M3Combobox from "./combobox";
export * as M3ContextMenu from "./context-menu";
export * as M3Dialog from "./dialog";
export * as M3Drawer from "./drawer";
export * as M3Field from "./field";
export * as M3Fieldset from "./fieldset";
export * as M3Menu from "./menu";
export * as M3Meter from "./meter";
export * as M3NavigationMenu from "./navigation-menu";
export * as M3NumberField from "./number-field";
export * as M3OtpField from "./otp-field";
export * as M3Popover from "./popover";
export * as M3PreviewCard from "./preview-card";
export * as M3Progress from "./progress";
export * as M3ScrollArea from "./scroll-area";
export * as M3Select from "./select";
export * as M3Slider from "./slider";
export * as M3Tabs from "./tabs";
export * as M3Toast from "./toast";
export * as M3Toolbar from "./toolbar";
export * as M3Tooltip from "./tooltip";

// Base UI pieces without a visual role.
export { CSPProvider } from "@base-ui/react/csp-provider";
export { DirectionProvider, useDirection } from "@base-ui/react/direction-provider";
export { mergeProps } from "@base-ui/react/merge-props";
export { useRender } from "@base-ui/react/use-render";
