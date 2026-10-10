// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/SelectPill.tsx), MIT, rebuilt on Material Design 3.

"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { forwardRef } from "react";

import { Icon } from "./Icon";
import { m3FocusRing, m3StateLayer } from "./utils";

/**
 * A pill-shaped picker trigger (label + trailing `expand_more`), styled as an M3 segment of a
 * connected button group: `outline-variant` outline, `secondary-container` when `selected`.
 */
const selectPillStyles = cva(
  [
    "flex cursor-pointer items-center gap-2 rounded-full border text-left",
    "transition-colors duration-200 ease-standard",
    "disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-on-surface/12 disabled:text-on-surface/38",
    m3StateLayer,
    m3FocusRing,
  ],
  {
    variants: {
      variant: {
        default: "border-outline-variant bg-surface-container-high text-on-surface",
        sidebar: "border-outline-variant bg-surface-container-low text-on-surface-variant",
        ghost: "border-transparent bg-transparent text-on-surface-variant",
      },
      // M3 button height is 40 dp (`lg`); `md` and `sm` are density steps.
      size: {
        sm: "h-7 px-3 text-label-medium",
        md: "h-8 px-3.5 text-label-large",
        lg: "h-10 px-4 text-label-large",
      },
      selected: {
        true: "border-transparent bg-secondary-container text-on-secondary-container",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
      selected: false,
    },
  },
);

export interface SelectPillProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof selectPillStyles> {
  /** Hide the caret icon */
  hideCaret?: boolean;
}

export const SelectPill = forwardRef<HTMLButtonElement, SelectPillProps>(
  ({ className, variant, size, selected, hideCaret, children, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      data-selected={selected ? "" : undefined}
      className={clsx(selectPillStyles({ variant, size, selected: !!selected }), className)}
      {...props}
    >
      {selected && <Icon name="check" size={18} />}
      <span className="flex flex-1 items-center gap-1.5 truncate text-left">{children}</span>
      {!hideCaret && <Icon name="expand_more" size={18} />}
    </button>
  ),
);

SelectPill.displayName = "SelectPill";

export { selectPillStyles };
