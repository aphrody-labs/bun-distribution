// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/ContextMenu.tsx), MIT, rebuilt on Material Design 3.
"use client";

import { ContextMenu as CM } from "@base-ui/react/context-menu";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import {
  type ContextType,
  createContext,
  isValidElement,
  type PropsWithChildren,
  type ReactElement,
  Suspense,
  useContext,
} from "react";

import {
  Icon,
  type IconComponentProps,
  type IconSource,
  renderIcon,
} from "./Icon";

interface ContextMenuProps extends Omit<CM.Popup.Props, "className"> {
  trigger: React.ReactNode;
  className?: string;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
}

/**
 * M3 menu motion, driven by Base UI's `data-starting-style` / `data-ending-style`: enter
 * emphasized-decelerate (medium1), exit emphasized-accelerate (short3).
 */
const menuMotion = clsx(
  "transition-[opacity,scale] duration-250 ease-emphasized-decelerate",
  "data-starting-style:scale-95 data-starting-style:opacity-0",
  "data-ending-style:scale-95 data-ending-style:opacity-0 data-ending-style:duration-150 data-ending-style:ease-emphasized-accelerate",
);

/** M3 menu container: `surface-container`, extra-small corners, level 2, 8dp vertical padding. */
export const contextMenuClassNames = clsx(
  "z-50 max-h-[calc(100vh-20px)] overflow-y-auto outline-none",
  "min-w-[112px] max-w-[280px] py-2",
  "bg-surface-container text-on-surface shadow-md3-2",
  "cursor-default select-none rounded-extra-small",
  "origin-(--transform-origin)",
);

const ContextMenuContext = createContext<boolean | null>(null);

export const useContextMenuContext = <T extends boolean>({
  suspense,
}: { suspense?: T } = {}) => {
  const ctx = useContext(ContextMenuContext);

  if (suspense && ctx === null)
    throw new Error("ContextMenuContext.Provider not found!");

  return ctx as T extends true
    ? NonNullable<ContextType<typeof ContextMenuContext>>
    : NonNullable<ContextType<typeof ContextMenuContext>> | undefined;
};

/**
 * Base UI context menu: opens at the pointer on right-click (and long-press on touch), with
 * typeahead, roving focus and submenus. `trigger` is the area that owns the menu.
 */
const Root = ({
  trigger,
  children,
  className,
  onOpenChange,
  disabled,
  ...props
}: ContextMenuProps) => {
  const area = isValidElement(trigger) ? (
    (trigger as ReactElement)
  ) : (
    <div>{trigger}</div>
  );
  return (
    <CM.Root disabled={disabled} onOpenChange={(open) => onOpenChange?.(open)}>
      <CM.Trigger render={area} />
      <CM.Portal>
        <CM.Positioner className="z-50 outline-none">
          <CM.Popup
            className={clsx(contextMenuClassNames, menuMotion, className)}
            {...props}
          >
            <ContextMenuContext.Provider value={true}>
              {children}
            </ContextMenuContext.Provider>
          </CM.Popup>
        </CM.Positioner>
      </CM.Portal>
    </CM.Root>
  );
};

export const contextMenuSeparatorClassNames = "my-2 h-px bg-outline-variant";

const Separator = (props: { className?: string }) => (
  <CM.Separator
    className={clsx(contextMenuSeparatorClassNames, props.className)}
  />
);

const SubMenu = ({
  label,
  icon,
  className,
  ...props
}: Omit<CM.Popup.Props, "className"> & ContextMenuItemProps) => {
  return (
    <CM.SubmenuRoot>
      <CM.SubmenuTrigger className={contextMenuItemClassNames} label={label}>
        <ContextMenuDivItem rightArrow {...{ label, icon }} />
      </CM.SubmenuTrigger>
      <CM.Portal>
        <Suspense fallback={null}>
          <CM.Positioner className="z-50 outline-none" alignOffset={-8}>
            <CM.Popup
              className={clsx(contextMenuClassNames, menuMotion, className)}
              {...(props as CM.Popup.Props)}
            />
          </CM.Positioner>
        </Suspense>
      </CM.Portal>
    </CM.SubmenuRoot>
  );
};

const contextMenuItemStyles = cva(
  [
    "flex max-h-fit min-h-8 items-center gap-3 overflow-hidden px-3",
    "text-label-large transition-colors duration-200 ease-standard",
    "group-data-[highlighted]:bg-on-surface/8 group-focus-visible:bg-on-surface/10 group-active:bg-on-surface/10",
    "group-data-[disabled]:pointer-events-none group-data-[disabled]:text-on-surface/38",
    "group-data-popup-open:bg-secondary-container group-data-popup-open:text-on-secondary-container",
    "group-data-checked:bg-secondary-container group-data-checked:text-on-secondary-container",
  ],
  {
    variants: {
      variant: {
        default: "text-on-surface",
        dull: "text-on-surface-variant",
        danger: [
          "text-error",
          "group-data-[highlighted]:bg-error/8 group-active:bg-error/10",
        ],
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface ContextMenuItemProps
  extends
    Omit<CM.Item.Props, "className" | "label">,
    VariantProps<typeof contextMenuItemStyles>,
    Pick<
      ContextMenuInnerItemProps,
      "label" | "keybind" | "icon" | "iconProps"
    > {
  className?: string;
}

/** Classes of the Base UI item element; the visible row is {@link ContextMenuDivItem}. */
export const contextMenuItemClassNames = "group outline-none";

const Item = ({
  icon,
  label,
  children,
  keybind,
  variant,
  iconProps,
  onClick,
  ...props
}: ContextMenuItemProps) => {
  return (
    <CM.Item
      {...props}
      label={label}
      className={clsx(contextMenuItemClassNames, props.className)}
      onClick={(e) => !props.disabled && onClick?.(e)}
    >
      <ContextMenuDivItem
        {...{ icon, iconProps, label, keybind, variant, children }}
      />
    </CM.Item>
  );
};

export interface ContextMenuCheckboxItemProps
  extends
    Omit<CM.CheckboxItem.Props, "className" | "label">,
    VariantProps<typeof contextMenuItemStyles>,
    Pick<ContextMenuInnerItemProps, "label" | "keybind"> {
  className?: string;
}

const CheckboxItem = ({
  variant,
  className,
  label,
  keybind,
  children,
  ...props
}: ContextMenuCheckboxItemProps) => {
  return (
    <CM.CheckboxItem
      className={contextMenuItemClassNames}
      label={label}
      {...props}
    >
      <ContextMenuDivItem variant={variant} className={className}>
        <span className="flex size-5 items-center justify-center">
          <CM.CheckboxItemIndicator className="flex">
            <Icon name="check" size={20} />
          </CM.CheckboxItemIndicator>
        </span>

        <ItemInternals {...{ label, keybind, children }} />
      </ContextMenuDivItem>
    </CM.CheckboxItem>
  );
};

/**
 * Props forwarded to the item icon. Upstream took Phosphor `IconProps`; `weight` may still be a
 * Phosphor weight name, which is ignored for Material Symbols.
 */
export type ContextMenuIconProps = Omit<IconComponentProps, "weight"> & {
  weight?: number | string;
  [key: string]: unknown;
};

interface ContextMenuInnerItemProps {
  icon?: IconSource;
  iconProps?: ContextMenuIconProps;
  label?: string;
  keybind?: string;
  rightArrow?: boolean;
}

export const ContextMenuDivItem = ({
  variant,
  children,
  className,
  ...props
}: ContextMenuInnerItemProps &
  VariantProps<typeof contextMenuItemStyles> &
  PropsWithChildren<{ className?: string }>) => (
  <div className={contextMenuItemStyles({ variant, className })}>
    {children || <ItemInternals {...props} variant={variant} />}
  </div>
);

const ItemInternals = ({
  icon,
  label,
  rightArrow,
  keybind,
  iconProps,
  variant,
}: ContextMenuInnerItemProps & VariantProps<typeof contextMenuItemStyles>) => {
  const {
    weight,
    className: iconClassName,
    ...restIconProps
  } = iconProps ?? {};

  return (
    <>
      {icon &&
        renderIcon(icon, {
          size: 20,
          ...(restIconProps as IconComponentProps),
          ...(typeof weight === "number" ? { weight } : {}),
          className: clsx(
            "shrink-0",
            variant !== "danger" && "text-on-surface-variant",
            iconClassName as string | undefined,
          ),
        })}
      {label && <span className="flex-1 truncate">{label}</span>}

      {keybind && (
        <span className="text-label-large text-on-surface-variant">
          {keybind}
        </span>
      )}
      {rightArrow && (
        <Icon
          name="chevron_right"
          size={20}
          className="ml-auto text-on-surface-variant"
        />
      )}
    </>
  );
};

export const ContextMenu = {
  Root,
  Item,
  CheckboxItem,
  Separator,
  SubMenu,
};
