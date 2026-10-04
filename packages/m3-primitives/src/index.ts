// @aphrody/m3-primitives — SpaceUI primitives rebuilt on Material Design 3, on the Base UI
// (@base-ui/react) headless layer
// (upstream: packages/aphrody-spaceui/packages/primitives, fusion rules: docs/design/SPACEUI-M3-FUSION.md)

// Button
export { Button, buttonStyles, buttonStyles as buttonVariants } from "./Button";
export type { ButtonProps, LinkButtonProps, ButtonBaseProps } from "./Button";

// Input
export {
  Input,
  SearchInput,
  TextArea,
  PasswordInput,
  Label,
  inputStyles,
  inputSizes,
} from "./Input";
export type { InputProps, TextareaProps, InputBaseProps, LabelProps } from "./Input";

// Checkbox
export { CheckBox, RadixCheckbox } from "./Checkbox";
export type { CheckBoxProps, RadixCheckboxProps } from "./Checkbox";
export { CheckboxRoot, CheckboxIndicator } from "./Checkbox";

// Switch
export { Switch } from "./Switch";
export type { SwitchProps } from "./Switch";

// Slider
export { Slider } from "./Slider";
export type { SliderProps } from "./Slider";

// RadioGroup
export { Root as RadioGroupRoot, Item as RadioGroupItem } from "./RadioGroup";
export type {
  RootProps as RadioGroupRootProps,
  ItemProps as RadioGroupItemProps,
} from "./RadioGroup";

// Dialog
export { Dialog, dialogManager, useDialog, Dialogs } from "./Dialog";
export type { DialogProps, DialogState, DialogOptions, UseDialogProps } from "./Dialog";
export type { DialogTriggerProps, DialogCloseProps, DialogContentProps } from "./Dialog";
export {
  DialogRoot,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "./Dialog";

// Popover (Base UI composable, Radix-compatible props)
export {
  Popover,
  usePopover,
  PopoverRoot,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
  PopoverClose,
  PopoverPortal,
} from "./Popover";
export type {
  PopoverRootProps,
  PopoverTriggerProps,
  PopoverCloseProps,
  PopoverContentProps,
} from "./Popover";

// Tooltip
export { Tooltip, TooltipProvider, Kbd } from "./Tooltip";
export type { TooltipProps } from "./Tooltip";
export { TooltipRoot, TooltipTrigger, TooltipPortal, TooltipContent } from "./Tooltip";
export type { TooltipProviderProps, TooltipTriggerProps, TooltipContentProps } from "./Tooltip";

// Tabs
export {
  Root as TabsRoot,
  List as TabsList,
  Trigger as TabsTrigger,
  Content as TabsContent,
  Indicator as TabsIndicator,
} from "./Tabs";
export type {
  RootProps as TabsRootProps,
  ListProps as TabsListProps,
  ContentProps as TabsContentProps,
  IndicatorProps as TabsIndicatorProps,
} from "./Tabs";

// DropdownMenu (Base UI Menu, Radix-compatible props)
export {
  DropdownMenu,
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
} from "./DropdownMenu";
export type {
  DropdownMenuRootProps,
  DropdownMenuTriggerProps,
  DropdownMenuContentProps,
  DropdownMenuItemProps,
} from "./DropdownMenu";

// ContextMenu (Base UI ContextMenu with the upstream object API)
export {
  ContextMenu,
  ContextMenuDivItem,
  useContextMenuContext,
  contextMenuClassNames,
  contextMenuItemClassNames,
  contextMenuSeparatorClassNames,
} from "./ContextMenu";
export type { ContextMenuItemProps, ContextMenuCheckboxItemProps } from "./ContextMenu";

// Dropdown (Base UI Menu, formerly Headless UI)
export * as Dropdown from "./Dropdown";

// Select
export { Select, SelectOption, selectStyles } from "./Select";
export type { SelectProps } from "./Select";
export {
  SelectRoot,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
} from "./Select";
export type { SelectRootProps, SelectContentProps, SelectItems } from "./Select";

// SelectPill
export { SelectPill, selectPillStyles } from "./SelectPill";
export type { SelectPillProps } from "./SelectPill";

// Toast (Sonner-based)
export { toast, Toaster, TOAST_TIMEOUT } from "./Toast";
export type { ToastId, ToastMessage } from "./Toast";

// Loader
export { Loader } from "./Loader";

// Divider
export { Divider } from "./Divider";

// ProgressBar
export { ProgressBar } from "./ProgressBar";
export type { ProgressBarProps } from "./ProgressBar";

// CircularProgress
export { CircularProgress } from "./CircularProgress";
export type { CircularProgressProps } from "./CircularProgress";

// SearchBar
export { SearchBar } from "./SearchBar";

// Shortcut
export { Shortcut } from "./Shortcut";
export type { ShortcutProps } from "./Shortcut";

// CircleButton (formerly TopBarButton)
export { CircleButton, circleButtonStyles } from "./CircleButton";
export type { CircleButtonProps } from "./CircleButton";
export { CircleButtonGroup } from "./CircleButtonGroup";
export type { CircleButtonGroupProps } from "./CircleButtonGroup";

// TabBar
export { TabBar, TabBarItem } from "./TabBar";
export type { TabBarProps, TabBarItemProps } from "./TabBar";

// Backward-compat aliases
export { CircleButton as TopBarButton } from "./CircleButton";
export { CircleButtonGroup as TopBarButtonGroup } from "./CircleButtonGroup";

// Shiny components
export { ShinyButton } from "./ShinyButton";
export type { ShinyButtonProps } from "./ShinyButton";
export { ShinyToggle } from "./ShinyToggle";

// InfoBanner
export { InfoBanner, InfoBannerText, InfoBannerSubtext } from "./InfoBanner";

// Layout
export { Card as LayoutCard, GridLayout } from "./Layout";

// Card (Spacebot-origin)
export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent } from "./Card";

// Typography
export { CategoryHeading, ScreenHeading } from "./Typography";

// Resizable
export { Resizable, ResizablePanel, ResizableHandle, useResizableContext } from "./Resizable";

// Keys
export {
  ModifierKeys,
  EditingKeys,
  UIKeys,
  NavigationKeys,
  modifierSymbols,
  keySymbols,
} from "./keys";
export type { OSforKeys } from "./keys";

// Utilities
export { tw } from "./utils";

// Forms
export { Form, FormRoot, ErrorMessage, errorStyles, z } from "./forms/Form";
export type { FormProps, FormRootProps, ErrorMessageProps } from "./forms/Form";

// SpaceItem (sidebar/list item with polymorphic icon)
export { SpaceItem } from "./SpaceItem";
export type { SpaceItemProps } from "./SpaceItem";

// Spacebot-origin components (kept from original extraction, audit pending)
export { Badge, badgeVariants } from "./Badge";
export { Banner, bannerVariants } from "./Banner";
export { ToggleGroup } from "./ToggleGroup";
export { Collapsible, CollapsibleTrigger, CollapsibleContent } from "./Collapsible";
export type {
  CollapsibleProps,
  CollapsibleTriggerProps,
  CollapsibleContentProps,
} from "./Collapsible";
export { NumberStepper } from "./NumberStepper";
export { FilterButton } from "./FilterButton";
export { OptionList, OptionListItem } from "./OptionList";
export { SelectTriggerButton } from "./SelectTriggerButton";

// Icon (Material Symbols, shares the <md-icon> tokens)
export { Icon, renderIcon, PHOSPHOR_TO_SYMBOL } from "./Icon";
export type { IconProps, IconSource, IconComponentProps } from "./Icon";

// M3 helpers and extra types
export { m3StateLayer, m3FocusRing } from "./utils";
export type { CardProps, CardVariant } from "./Card";
export type { DividerProps } from "./Divider";
export { dialogSurfaceClassNames } from "./Dialog";
export { popoverSurfaceClassNames } from "./Popover";
export { tooltipClassNames } from "./Tooltip";
export { menuSurfaceClassNames, menuItemClassNames } from "./DropdownMenu";
export type { ContextMenuIconProps } from "./ContextMenu";
export type { CheckboxRootProps } from "./Checkbox";
export type { TriggerProps as TabsTriggerProps } from "./Tabs";

// Accordion (Base UI)
export {
  Accordion,
  AccordionRoot,
  AccordionItem,
  AccordionHeader,
  AccordionTrigger,
  AccordionPanel,
} from "./Accordion";
export type {
  AccordionRootProps,
  AccordionItemProps,
  AccordionHeaderProps,
  AccordionTriggerProps,
  AccordionPanelProps,
} from "./Accordion";

// ScrollArea (Base UI)
export {
  ScrollArea,
  ScrollAreaRoot,
  ScrollAreaViewport,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaCorner,
} from "./ScrollArea";
export type {
  ScrollAreaRootProps,
  ScrollAreaViewportProps,
  ScrollAreaScrollbarProps,
  ScrollAreaThumbProps,
  ScrollAreaCornerProps,
} from "./ScrollArea";

// AlertDialog (Base UI)
export {
  AlertDialog,
  AlertDialogRoot,
  AlertDialogTrigger,
  AlertDialogPortal,
  AlertDialogBackdrop,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogClose,
} from "./AlertDialog";
export type {
  AlertDialogProps,
  AlertDialogRootProps,
  AlertDialogTriggerProps,
  AlertDialogPortalProps,
  AlertDialogBackdropProps,
  AlertDialogPopupProps,
  AlertDialogTitleProps,
  AlertDialogDescriptionProps,
  AlertDialogCloseProps,
} from "./AlertDialog";

// Avatar (Base UI)
export { Avatar, AvatarRoot, AvatarImage, AvatarFallback } from "./Avatar";
export type {
  AvatarProps,
  AvatarRootProps,
  AvatarImageProps,
  AvatarFallbackProps,
} from "./Avatar";

// Meter (Base UI)
export {
  Meter,
  MeterRoot,
  MeterLabel,
  MeterTrack,
  MeterIndicator,
  MeterValue,
} from "./Meter";
export type {
  MeterProps,
  MeterRootProps,
  MeterLabelProps,
  MeterTrackProps,
  MeterIndicatorProps,
  MeterValueProps,
} from "./Meter";

// Field (Base UI)
export { Field, FieldRoot, FieldLabel, FieldControl, FieldDescription, FieldError, FieldValidity } from "./Field";
export type {
  FieldRootProps,
  FieldLabelProps,
  FieldControlProps,
  FieldDescriptionProps,
  FieldErrorProps,
  FieldValidityProps,
} from "./Field";

// Drawer (Base UI)
export {
  Drawer,
  DrawerRoot,
  DrawerTrigger,
  DrawerPortal,
  DrawerBackdrop,
  DrawerPopup,
  DrawerTitle,
  DrawerDescription,
  DrawerClose,
} from "./Drawer";
export type {
  DrawerRootProps,
  DrawerTriggerProps,
  DrawerPortalProps,
  DrawerBackdropProps,
  DrawerPopupProps,
  DrawerTitleProps,
  DrawerDescriptionProps,
  DrawerCloseProps,
} from "./Drawer";
