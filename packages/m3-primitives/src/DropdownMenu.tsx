// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/DropdownMenu.tsx), MIT, rebuilt on Material Design 3.
"use client";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { clsx } from "clsx";
import {
  createContext,
  forwardRef,
  type ForwardRefExoticComponent,
  type HTMLAttributes,
  type RefAttributes,
  useContext,
} from "react";

import { type AsChildProp, asChildProps, createPortalScope, withClassName } from "./base-ui";
import { Icon } from "./Icon";

/**
 * M3 menu motion, driven by Base UI's `data-starting-style` / `data-ending-style`: enter
 * emphasized-decelerate (medium1), exit emphasized-accelerate (short3). Base UI keeps the popup
 * mounted until the exit transition ends.
 */
const menuMotion = clsx(
  "transition-[opacity,scale] duration-250 ease-emphasized-decelerate",
  "data-starting-style:scale-95 data-starting-style:opacity-0",
  "data-ending-style:scale-95 data-ending-style:opacity-0 data-ending-style:duration-150 data-ending-style:ease-emphasized-accelerate",
);

/** M3 menu container: `surface-container`, extra-small corners, level 2, 8dp vertical padding. */
export const menuSurfaceClassNames = clsx(
  "z-50 min-w-[112px] max-w-[280px] overflow-hidden py-2 outline-none",
  "rounded-extra-small bg-surface-container shadow-md3-2",
  "text-label-large text-on-surface",
  "origin-(--transform-origin)",
);

/** M3 menu item (desktop density, 32dp), state layers on `on-surface`. */
export const menuItemClassNames = clsx(
  "relative flex min-h-8 cursor-default select-none items-center gap-3 px-3 outline-none",
  "text-label-large text-on-surface transition-colors duration-200 ease-standard",
  "data-[highlighted]:bg-on-surface/8 focus-visible:bg-on-surface/10 active:bg-on-surface/10",
  "data-[disabled]:pointer-events-none data-[disabled]:text-on-surface/38",
);

export type DropdownMenuRootProps = MenuPrimitive.Root.Props;

/** Base UI menu root (`modal` by default, like Radix). */
const Root = (props: DropdownMenuRootProps) => <MenuPrimitive.Root {...props} />;
Root.displayName = "DropdownMenuRoot";

export interface DropdownMenuTriggerProps extends MenuPrimitive.Trigger.Props, AsChildProp {}

const Trigger = forwardRef<HTMLButtonElement, DropdownMenuTriggerProps>(({ asChild, children, ...props }, ref) => (
  <MenuPrimitive.Trigger ref={ref} {...asChildProps(asChild, children)} {...props} />
));
Trigger.displayName = "DropdownMenuTrigger";

/** Whether the enclosing element is a Base UI menu group (group labels require one). */
const InGroup = createContext(false);

const Group = forwardRef<HTMLDivElement, MenuPrimitive.Group.Props>((props, ref) => (
  <InGroup.Provider value={true}>
    <MenuPrimitive.Group ref={ref} {...props} />
  </InGroup.Provider>
));
Group.displayName = "DropdownMenuGroup";

const RadioGroup = forwardRef<HTMLDivElement, MenuPrimitive.RadioGroup.Props>((props, ref) => (
  <InGroup.Provider value={true}>
    <MenuPrimitive.RadioGroup ref={ref} {...props} />
  </InGroup.Provider>
));
RadioGroup.displayName = "DropdownMenuRadioGroup";

const { Portal, EnsurePortal } = createPortalScope(MenuPrimitive.Portal, "DropdownMenuPortal");

type PositionerProps = Pick<
  MenuPrimitive.Positioner.Props,
  | "side"
  | "sideOffset"
  | "align"
  | "alignOffset"
  | "collisionPadding"
  | "collisionAvoidance"
  | "sticky"
  | "anchor"
  | "positionMethod"
>;

export interface DropdownMenuContentProps extends PositionerProps, MenuPrimitive.Popup.Props {
  /** Radix name for the portal's `keepMounted`. */
  forceMount?: boolean;
}

function menuContent(defaultSideOffset: number, displayName: string) {
  const Content = forwardRef<HTMLDivElement, DropdownMenuContentProps>(
    (
      {
        className,
        side,
        sideOffset = defaultSideOffset,
        align,
        alignOffset,
        collisionPadding,
        collisionAvoidance,
        sticky,
        anchor,
        positionMethod,
        forceMount,
        ...props
      },
      ref,
    ) => (
      <EnsurePortal keepMounted={forceMount}>
        <MenuPrimitive.Positioner
          className="z-50 outline-none"
          side={side}
          sideOffset={sideOffset}
          align={align}
          alignOffset={alignOffset}
          collisionPadding={collisionPadding}
          collisionAvoidance={collisionAvoidance}
          sticky={sticky}
          anchor={anchor}
          positionMethod={positionMethod}
        >
          <MenuPrimitive.Popup
            ref={ref}
            className={withClassName(clsx(menuSurfaceClassNames, menuMotion), className)}
            {...props}
          />
        </MenuPrimitive.Positioner>
      </EnsurePortal>
    ),
  );
  Content.displayName = displayName;
  return Content;
}

const Content = menuContent(4, "DropdownMenuContent");

export interface DropdownMenuItemProps extends Omit<MenuPrimitive.Item.Props, "onSelect"> {
  inset?: boolean;
  /** Radix name: called when the item is chosen (Base UI `onClick`). */
  onSelect?: (event: Event) => void;
}

const Item = forwardRef<HTMLDivElement, DropdownMenuItemProps>(
  ({ className, inset, onSelect, onClick, ...props }, ref) => (
    <MenuPrimitive.Item
      ref={ref}
      className={withClassName(clsx(menuItemClassNames, inset && "pl-11"), className)}
      onClick={
        onSelect
          ? event => {
              onClick?.(event);
              onSelect(event.nativeEvent);
            }
          : onClick
      }
      {...props}
    />
  ),
);
Item.displayName = "DropdownMenuItem";

const CheckboxItem = forwardRef<HTMLDivElement, MenuPrimitive.CheckboxItem.Props>(
  ({ className, children, ...props }, ref) => (
    <MenuPrimitive.CheckboxItem
      ref={ref}
      className={withClassName(
        clsx(menuItemClassNames, "pl-11 data-checked:bg-secondary-container data-checked:text-on-secondary-container"),
        className,
      )}
      {...props}
    >
      <span className="absolute left-3 flex size-5 items-center justify-center">
        <MenuPrimitive.CheckboxItemIndicator className="flex">
          <Icon name="check" size={20} />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  ),
);
CheckboxItem.displayName = "DropdownMenuCheckboxItem";

const RadioItem = forwardRef<HTMLDivElement, MenuPrimitive.RadioItem.Props>(
  ({ className, children, ...props }, ref) => (
    <MenuPrimitive.RadioItem
      ref={ref}
      className={withClassName(
        clsx(menuItemClassNames, "pl-11 data-checked:bg-secondary-container data-checked:text-on-secondary-container"),
        className,
      )}
      {...props}
    >
      <span className="absolute left-3 flex size-5 items-center justify-center">
        <MenuPrimitive.RadioItemIndicator className="flex">
          <Icon name="radio_button_checked" size={20} filled />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  ),
);
RadioItem.displayName = "DropdownMenuRadioItem";

const labelClassNames = "px-3 py-2 text-title-small text-on-surface-variant";

/**
 * Menu section label. Inside a `Group` / `RadioGroup` it is the Base UI group label (it names
 * the group through `aria-labelledby`); elsewhere it is a presentational heading, as in Radix.
 */
const Label = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => {
  const inGroup = useContext(InGroup);
  const classes = clsx(labelClassNames, inset && "pl-11", className);
  return inGroup ? (
    <MenuPrimitive.GroupLabel ref={ref} className={classes} {...props} />
  ) : (
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a menu heading outside a group is decorative inside role="menu".
    <div ref={ref} role="presentation" className={classes} {...props} />
  );
});
Label.displayName = "DropdownMenuLabel";

const Separator: ForwardRefExoticComponent<MenuPrimitive.Separator.Props & RefAttributes<HTMLDivElement>> = forwardRef<
  HTMLDivElement,
  MenuPrimitive.Separator.Props
>(({ className, ...props }, ref) => (
  <MenuPrimitive.Separator ref={ref} className={withClassName("my-2 h-px bg-outline-variant", className)} {...props} />
));
Separator.displayName = "DropdownMenuSeparator";

/** Base UI submenu root. */
const Sub = (props: MenuPrimitive.SubmenuRoot.Props) => <MenuPrimitive.SubmenuRoot {...props} />;
Sub.displayName = "DropdownMenuSub";

const SubTrigger = forwardRef<
  HTMLDivElement,
  MenuPrimitive.SubmenuTrigger.Props & {
    inset?: boolean;
  }
>(({ className, inset, children, ...props }, ref) => (
  <MenuPrimitive.SubmenuTrigger
    ref={ref}
    className={withClassName(
      clsx(
        menuItemClassNames,
        "data-popup-open:bg-secondary-container data-popup-open:text-on-secondary-container",
        inset && "pl-11",
      ),
      className,
    )}
    {...props}
  >
    {children}
    <Icon name="chevron_right" size={20} className="ml-auto text-on-surface-variant" />
  </MenuPrimitive.SubmenuTrigger>
));
SubTrigger.displayName = "DropdownMenuSubTrigger";

/** Submenu surface; Base UI places it beside its trigger (`side` defaults to `inline-end`). */
const SubContent = menuContent(0, "DropdownMenuSubContent");

export const DropdownMenu: {
  Root: typeof Root;
  Trigger: typeof Trigger;
  Content: typeof Content;
  Item: typeof Item;
  CheckboxItem: typeof CheckboxItem;
  RadioItem: typeof RadioItem;
  Label: typeof Label;
  Separator: typeof Separator;
  Group: typeof Group;
  Portal: typeof Portal;
  Sub: typeof Sub;
  SubTrigger: typeof SubTrigger;
  SubContent: typeof SubContent;
  RadioGroup: typeof RadioGroup;
} = {
  Root,
  Trigger,
  Content,
  Item,
  CheckboxItem,
  RadioItem,
  Label,
  Separator,
  Group,
  Portal,
  Sub,
  SubTrigger,
  SubContent,
  RadioGroup,
};

// Named exports
export {
  Root as DropdownMenuRoot,
  Trigger as DropdownMenuTrigger,
  Content as DropdownMenuContent,
  Item as DropdownMenuItem,
  CheckboxItem as DropdownMenuCheckboxItem,
  RadioItem as DropdownMenuRadioItem,
  Label as DropdownMenuLabel,
  Separator as DropdownMenuSeparator,
  Group as DropdownMenuGroup,
  Portal as DropdownMenuPortal,
  Sub as DropdownMenuSub,
  SubTrigger as DropdownMenuSubTrigger,
  SubContent as DropdownMenuSubContent,
  RadioGroup as DropdownMenuRadioGroup,
};
