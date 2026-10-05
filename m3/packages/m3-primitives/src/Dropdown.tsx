// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/Dropdown.tsx), MIT, rebuilt on Material Design 3.
"use client";

import { Menu } from "@base-ui/react/menu";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { forwardRef, type PropsWithChildren } from "react";

import { Button as UIButton, type ButtonProps as UIButtonProps } from "./Button";
import { Icon, type IconSource, renderIcon } from "./Icon";

export const Section = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={clsx("py-2", className)} {...props} />
);

/** M3 menu item (desktop density, 32dp); `selected` is the M3 active indicator. */
const itemStyles = cva(
  [
    "group flex min-h-8 w-full shrink-0 grow items-center gap-3 whitespace-nowrap px-3 outline-none",
    "text-label-large transition-colors duration-200 ease-standard",
    "disabled:pointer-events-none disabled:text-on-surface/38 data-disabled:pointer-events-none data-disabled:text-on-surface/38",
  ],
  {
    variants: {
      selected: {
        true: "bg-secondary-container text-on-secondary-container",
        undefined:
          "text-on-surface hover:bg-on-surface/8 data-highlighted:bg-on-surface/8 active:bg-on-surface/10",
        false:
          "text-on-surface hover:bg-on-surface/8 data-highlighted:bg-on-surface/8 active:bg-on-surface/10",
      },
      active: {
        true: "bg-on-surface/10",
      },
    },
  },
);

const itemIconStyles = cva("shrink-0", {
  variants: {
    selected: {
      true: "text-on-secondary-container",
      false: "text-on-surface-variant",
      undefined: "text-on-surface-variant",
    },
  },
});

type DropdownItemProps = PropsWithChildren<{
  to?: string;
  className?: string;
  /** A Material Symbols name, an element or an icon component (a Phosphor icon still works). */
  icon?: IconSource;
  iconClassName?: string;
  onClick?: () => void;
}> &
  VariantProps<typeof itemStyles>;

export const Item = ({ to, className, icon, children, ...props }: DropdownItemProps) => {
  const { iconClassName, selected, active, ...rest } = props;
  const content = (
    <>
      {icon &&
        renderIcon(icon, {
          size: 20,
          className: clsx(itemIconStyles({ selected }), iconClassName),
        })}
      <span className="text-left">{children}</span>
    </>
  );
  const classes = clsx(itemStyles({ selected, active }), className);
  // Base UI menu items: roving highlight, typeahead and close-on-click; links stay real anchors.
  return to ? (
    <Menu.LinkItem {...rest} href={to} closeOnClick className={classes}>
      {content}
    </Menu.LinkItem>
  ) : (
    // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- name comes from the consumer (aria-label, aria-labelledby or associated label)
    <Menu.Item {...rest} nativeButton render={<button type="button" />} className={classes}>
      {content}
    </Menu.Item>
  );
};

export const Button = forwardRef<HTMLButtonElement, UIButtonProps>(
  ({ children, className, ...props }, ref) => {
    return (
      <UIButton
        size="sm"
        ref={ref as never}
        className={clsx("group flex text-left", className)}
        {...props}
      >
        {children}
        <span className="grow" />
        <Icon
          name="arrow_drop_down"
          size={20}
          className="ml-2 shrink-0 text-on-surface-variant transition-transform duration-200 ease-standard in-data-popup-open:rotate-180"
        />
      </UIButton>
    );
  },
);

Button.displayName = "DropdownButton";

export interface DropdownRootProps {
  button: React.ReactNode;
  className?: string;
  itemsClassName?: string;
  align?: "left" | "right";
}

/**
 * M3 menu anchored under a caller-supplied button, on Base UI `Menu` (keyboard navigation,
 * typeahead, focus return, Escape / outside-press dismissal). The menu is at least as wide as the
 * trigger and aligns to its `left` or `right` edge.
 */
export const Root = (props: PropsWithChildren<DropdownRootProps>) => {
  return (
    <div className={props.className}>
      <Menu.Root>
        <div className="relative flex w-full justify-end text-left">
          <Menu.Trigger
            // The trigger wraps the caller's `button` node, usually a <Dropdown.Button> (a native
            // <button>); a <div role="button"> wrapper avoids nesting interactive content.
            nativeButton={false}
            render={<div />}
            className="outline-none"
          >
            {props.button}
          </Menu.Trigger>
        </div>
        <Menu.Portal>
          <Menu.Positioner
            className="z-50 outline-none"
            side="bottom"
            align={props.align === "left" ? "start" : "end"}
            sideOffset={4}
          >
            <Menu.Popup
              className={clsx(
                "w-(--anchor-width) min-w-fit max-w-[280px] divide-y divide-outline-variant outline-none",
                "rounded-extra-small bg-surface-container text-on-surface shadow-md3-2",
                "origin-(--transform-origin) transition-[opacity,scale]",
                "duration-250 ease-emphasized-decelerate",
                "data-starting-style:scale-y-90 data-starting-style:opacity-0",
                "data-ending-style:scale-y-90 data-ending-style:opacity-0 data-ending-style:duration-150 data-ending-style:ease-emphasized-accelerate",
                props.itemsClassName,
              )}
            >
              {props.children}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
};

export const Separator = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={clsx("my-2 h-px bg-outline-variant", className)} {...props} />
);
