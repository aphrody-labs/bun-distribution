// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/OptionList.tsx), MIT, rebuilt on Material Design 3.

import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { forwardRef } from "react";

import { m3FocusRing, m3StateLayer } from "./utils";

export interface OptionListProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * A compact M3 list of choices: `on-surface` rows with the on-surface state layer, the selected
 * row on `secondary-container` (the M3 selection indicator), corner `small`.
 */
const optionListItemStyles = cva(
  [
    "flex w-full cursor-pointer items-center gap-2 rounded-small text-left",
    "transition-colors duration-200 ease-standard",
    "disabled:pointer-events-none disabled:cursor-not-allowed disabled:text-on-surface/38",
    m3StateLayer,
    m3FocusRing,
  ],
  {
    variants: {
      // M3 list/menu rows are 48-56 dp; these are desktop density steps.
      size: {
        sm: "min-h-7 px-3 py-1 text-label-medium",
        md: "min-h-8 px-3 py-1.5 text-label-large",
        lg: "min-h-10 px-4 py-2 text-body-large",
      },
      selected: {
        true: "bg-secondary-container text-on-secondary-container",
        false: "text-on-surface",
      },
    },
    defaultVariants: {
      size: "md",
      selected: false,
    },
  },
);

export interface OptionListItemProps
  extends
    Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "size">,
    VariantProps<typeof optionListItemStyles> {}

const OptionList = forwardRef<HTMLDivElement, OptionListProps>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={clsx("flex flex-col gap-0.5", className)}
        data-m3-component="OptionList"
        {...props}
      />
    );
  },
);

OptionList.displayName = "OptionList";

const OptionListItem = forwardRef<HTMLButtonElement, OptionListItemProps>(
  ({ className, selected, size, type = "button", ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        aria-pressed={!!selected}
        data-m3-component="OptionListItem"
        className={clsx(
          optionListItemStyles({ size, selected: !!selected }),
          className,
        )}
        {...props}
      />
    );
  },
);

OptionListItem.displayName = "OptionListItem";

export { OptionList, OptionListItem, optionListItemStyles };
