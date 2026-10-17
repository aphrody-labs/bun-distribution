// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/Select.tsx), MIT, rebuilt on Material Design 3.
"use client";

import { Select as RS } from "@base-ui/react/select";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import {
  Children,
  createContext,
  forwardRef,
  isValidElement,
  type HTMLAttributes,
  type PropsWithChildren,
  type ReactNode,
  useContext,
} from "react";

import { withClassName } from "./base-ui";
import { Icon } from "./Icon";

/**
 * M3 exposed dropdown menu. The trigger is an M3 text field (`outlined`, the default, or
 * `filled`); the content is an M3 menu (`surface-container`, extra-small corners, level 2).
 *
 * `size` maps the upstream heights to M3 density steps: `sm` 32dp (upstream default), `md`
 * 40dp, `lg` 48dp, `xl` 56dp (the M3 baseline). Menu items follow: 32 / 40 / 48 / 48dp.
 */
export const selectStyles = cva(
  [
    "group relative flex items-center justify-between gap-2 whitespace-nowrap text-left",
    "text-on-surface data-[placeholder]:text-on-surface-variant",
    "outline-none transition-[background-color,border-color,box-shadow] duration-200 ease-standard",
    "disabled:cursor-not-allowed disabled:opacity-38 data-disabled:cursor-not-allowed data-disabled:opacity-38",
  ],
  {
    variants: {
      variant: {
        default: [
          "rounded-extra-small border border-outline bg-transparent hover:border-on-surface",
          "focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary",
          "data-popup-open:border-primary data-popup-open:ring-1 data-popup-open:ring-inset data-popup-open:ring-primary",
        ],
        outlined: [
          "rounded-extra-small border border-outline bg-transparent hover:border-on-surface",
          "focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary",
          "data-popup-open:border-primary data-popup-open:ring-1 data-popup-open:ring-inset data-popup-open:ring-primary",
        ],
        filled: [
          "rounded-t-extra-small rounded-b-none border-0 border-b border-on-surface-variant bg-surface-container-highest hover:border-on-surface",
          "before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:bg-on-surface before:opacity-0 before:transition-opacity before:content-[''] hover:before:opacity-8",
          "focus-visible:border-primary focus-visible:shadow-[inset_0_-1px_0_0_var(--md-sys-color-primary)]",
          "data-popup-open:border-primary data-popup-open:shadow-[inset_0_-1px_0_0_var(--md-sys-color-primary)]",
        ],
      },
      size: {
        sm: "h-8 pl-3 pr-1 text-body-medium",
        md: "h-10 pl-3 pr-2 text-body-medium",
        lg: "h-12 pl-4 pr-2 text-body-large",
        xl: "h-14 pl-4 pr-3 text-body-large",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "sm",
    },
  },
);

type SelectSize = "sm" | "md" | "lg" | "xl";

/** Menu density, inherited by the items from the `Select` that renders them. */
const SelectSizeContext = createContext<SelectSize>("md");

const itemHeights: Record<SelectSize, string> = {
  sm: "h-8",
  md: "h-10",
  lg: "h-12",
  xl: "h-12",
};

const menuContent = clsx(
  "min-w-(--anchor-width) max-h-(--available-height) overflow-y-auto rounded-extra-small bg-surface-container py-2 text-on-surface shadow-md3-2 outline-none",
  "origin-(--transform-origin) transition-[opacity,scale] duration-250 ease-emphasized-decelerate",
  "data-starting-style:scale-95 data-starting-style:opacity-0",
  "data-ending-style:scale-95 data-ending-style:opacity-0 data-ending-style:duration-150 data-ending-style:ease-emphasized-accelerate",
  "data-[side=none]:transition-none",
);

const menuItem = [
  "relative flex w-full cursor-pointer select-none items-center gap-3 pl-11 pr-3 outline-none",
  "text-label-large text-on-surface",
  // State layer (on-surface 8 % hover / keyboard highlight).
  "before:pointer-events-none before:absolute before:inset-0 before:content-[''] data-[highlighted]:before:bg-on-surface/8",
  // Selected: M3 active indicator.
  "data-selected:bg-secondary-container data-selected:text-on-secondary-container",
  "data-[disabled]:pointer-events-none data-[disabled]:opacity-38",
];

const DropdownIcon = ({ size }: { size: number }) => (
  <Icon
    name="arrow_drop_down"
    size={size}
    className="text-on-surface-variant transition-transform duration-200 ease-standard group-data-popup-open:rotate-180"
  />
);

/** `value → label` pairs for Base UI `items`, so the trigger shows the label before the popup mounts. */
export type SelectItems = Record<string, ReactNode>;

/**
 * Collects the `SelectItem` / `SelectOption` elements written in `children` (at any depth of
 * element props) into Base UI `items`. Items rendered by other components are not visible here;
 * pass `items` to `SelectRoot` for those.
 */
function collectItems(children: ReactNode, into: SelectItems = {}): SelectItems {
  Children.forEach(children, child => {
    if (!isValidElement(child)) return;
    const props = child.props as { value?: unknown; children?: ReactNode };
    if ((child.type === SelectItem || child.type === SelectOption) && typeof props.value === "string") {
      into[props.value] = props.children;
      return;
    }
    if (props.children !== undefined) collectItems(props.children, into);
  });
  return into;
}

const hasItems = (items: SelectItems) => Object.keys(items).length > 0;

export interface SelectProps<TValue extends string = string> extends VariantProps<typeof selectStyles> {
  value: TValue;
  onChange: (value: TValue) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  containerClassName?: string;
  /** Form field name (Base UI renders a hidden input). */
  name?: string;
  required?: boolean;
}

/**
 * M3 exposed dropdown menu on Base UI `Select`: a listbox with typeahead, keyboard navigation and
 * a hidden input, so it takes part in native forms.
 */
export const Select = forwardRef(
  <TValue extends string = string>(
    props: PropsWithChildren<SelectProps<TValue>>,
    ref: React.ForwardedRef<HTMLDivElement>,
  ) => {
    const size: SelectSize = props.size ?? "sm";
    const items = collectItems(props.children);
    return (
      <div className={props.containerClassName} data-m3-component="Select" ref={ref}>
        <SelectSizeContext.Provider value={size}>
          <RS.Root
            value={props.value}
            onValueChange={value => {
              if (value !== null) props.onChange(value as TValue);
            }}
            items={hasItems(items) ? items : undefined}
            disabled={props.disabled}
            name={props.name}
            required={props.required}
          >
            <RS.Trigger
              className={selectStyles({
                variant: props.variant,
                size,
                className: props.className,
              })}
            >
              <span className="relative truncate">
                <RS.Value placeholder={props.placeholder} />
              </span>
              <RS.Icon className="relative flex">
                <DropdownIcon size={size === "sm" ? 20 : 24} />
              </RS.Icon>
            </RS.Trigger>

            <RS.Portal>
              <RS.Positioner className="z-[100] outline-none" sideOffset={4} alignItemWithTrigger={false}>
                <RS.Popup className={menuContent}>
                  <RS.List>{props.children}</RS.List>
                </RS.Popup>
              </RS.Positioner>
            </RS.Portal>
          </RS.Root>
        </SelectSizeContext.Provider>
      </div>
    );
  },
) as <TValue extends string = string>(
  props: PropsWithChildren<SelectProps<TValue>> & {
    ref?: React.ForwardedRef<HTMLDivElement>;
  },
) => React.ReactElement;

const ItemCheck = () => (
  <span className="absolute left-3 flex items-center justify-center">
    <RS.ItemIndicator className="flex">
      <Icon name="check" size={20} />
    </RS.ItemIndicator>
  </span>
);

export function SelectOption(props: PropsWithChildren<{ value: string; default?: boolean }>) {
  const size = useContext(SelectSizeContext);
  return (
    <RS.Item value={props.value} className={clsx(menuItem, itemHeights[size])}>
      <ItemCheck />
      <RS.ItemText>{props.children}</RS.ItemText>
    </RS.Item>
  );
}

export interface SelectRootProps extends Omit<RS.Root.Props<string>, "onValueChange" | "items"> {
  /** Called with the chosen value (Radix shape; Base UI adds the event details). */
  onValueChange?: (value: string, eventDetails: RS.Root.ChangeEventDetails) => void;
  /**
   * Base UI `items`: labels shown in the trigger before the popup opens. Derived from the
   * `SelectItem` elements in `children` when omitted.
   */
  items?: RS.Root.Props<string>["items"];
}

/** Composable Base UI select root (Radix-compatible `onValueChange`). */
export const SelectRoot = ({ onValueChange, items, children, ...props }: SelectRootProps) => {
  const derived = items ?? collectItems(children);
  return (
    <RS.Root<string>
      {...props}
      items={Array.isArray(derived) || hasItems(derived as SelectItems) ? derived : undefined}
      onValueChange={
        onValueChange &&
        ((value, details) => {
          if (typeof value === "string") onValueChange(value, details);
        })
      }
    >
      {children}
    </RS.Root>
  );
};

/** Whether the enclosing element is a `SelectGroup` (group labels require one). */
const InGroup = createContext(false);

export const SelectGroup = ({ ...props }: RS.Group.Props) => (
  <InGroup.Provider value={true}>
    <RS.Group {...props} />
  </InGroup.Provider>
);

export const SelectValue = RS.Value;

export const SelectTrigger = ({ className, children, ...props }: RS.Trigger.Props) => (
  <RS.Trigger
    className={withClassName(clsx(selectStyles({ size: "md" }), "w-full [&>span]:line-clamp-1"), className)}
    {...props}
  >
    {children}
    <RS.Icon className="relative flex">
      <DropdownIcon size={24} />
    </RS.Icon>
  </RS.Trigger>
);

SelectTrigger.displayName = "SelectTrigger";

const scrollArrow = clsx(
  "absolute inset-x-0 z-10 flex h-6 cursor-default items-center justify-center bg-surface-container text-on-surface-variant",
);

export const SelectScrollUpButton = ({ className, ...props }: RS.ScrollUpArrow.Props) => (
  <RS.ScrollUpArrow className={withClassName(clsx(scrollArrow, "top-0 rounded-t-extra-small"), className)} {...props}>
    <Icon name="expand_less" size={20} />
  </RS.ScrollUpArrow>
);

SelectScrollUpButton.displayName = "SelectScrollUpButton";

export const SelectScrollDownButton = ({ className, ...props }: RS.ScrollDownArrow.Props) => (
  <RS.ScrollDownArrow
    className={withClassName(clsx(scrollArrow, "bottom-0 rounded-b-extra-small"), className)}
    {...props}
  >
    <Icon name="expand_more" size={20} />
  </RS.ScrollDownArrow>
);

SelectScrollDownButton.displayName = "SelectScrollDownButton";

type SelectPositionerProps = Pick<
  RS.Positioner.Props,
  "side" | "sideOffset" | "align" | "alignOffset" | "collisionPadding" | "sticky"
>;

export interface SelectContentProps extends SelectPositionerProps, RS.Popup.Props {
  /**
   * Radix placement mode. `popper` (default) opens below the trigger; `item-aligned` overlaps
   * the trigger with the selected item (Base UI `alignItemWithTrigger`, macOS style).
   */
  position?: "popper" | "item-aligned";
}

export const SelectContent = ({
  className,
  children,
  position = "popper",
  side,
  sideOffset = 4,
  align,
  alignOffset,
  collisionPadding,
  sticky,
  ...props
}: SelectContentProps) => (
  <RS.Portal>
    <RS.Positioner
      className="z-[100] outline-none"
      alignItemWithTrigger={position === "item-aligned"}
      side={side}
      sideOffset={sideOffset}
      align={align}
      alignOffset={alignOffset}
      collisionPadding={collisionPadding}
      sticky={sticky}
    >
      <RS.Popup className={withClassName(clsx("relative max-h-96 min-w-[8rem]", menuContent), className)} {...props}>
        <SelectScrollUpButton />
        <RS.List>{children}</RS.List>
        <SelectScrollDownButton />
      </RS.Popup>
    </RS.Positioner>
  </RS.Portal>
);

SelectContent.displayName = "SelectContent";

/**
 * Section label. Inside a `SelectGroup` it is the Base UI group label (it names the group);
 * elsewhere it is a presentational heading, as with Radix.
 */
export const SelectLabel = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => {
  const inGroup = useContext(InGroup);
  const classes = clsx("px-3 py-2 pl-11 text-title-small text-on-surface-variant", className);
  return inGroup ? (
    <RS.GroupLabel className={classes} {...props} />
  ) : (
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a heading outside a group is decorative inside role="listbox".
    <div role="presentation" className={classes} {...props} />
  );
};

SelectLabel.displayName = "SelectLabel";

export const SelectItem = ({ className, children, ...props }: RS.Item.Props) => {
  const size = useContext(SelectSizeContext);
  return (
    <RS.Item className={withClassName(clsx(menuItem, itemHeights[size]), className)} {...props}>
      <ItemCheck />
      <RS.ItemText>{children}</RS.ItemText>
    </RS.Item>
  );
};

SelectItem.displayName = "SelectItem";

export const SelectSeparator = ({ className, ...props }: RS.Separator.Props) => (
  <RS.Separator className={withClassName("my-2 h-px bg-outline-variant", className)} {...props} />
);

SelectSeparator.displayName = "SelectSeparator";
