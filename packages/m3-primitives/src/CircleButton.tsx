// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/CircleButton.tsx), MIT, rebuilt on Material Design 3.

"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { forwardRef } from "react";

import { type IconSource, renderIcon } from "./Icon";
import { m3FocusRing, m3StateLayer } from "./utils";

/** M3 icon button (standard / filled / tonal / outlined), 40 dp container by default. */
export const circleButtonStyles = cva(
  [
    "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full border",
    "transition-[background-color,border-color,color,transform] duration-200 ease-standard",
    "active:scale-95 disabled:pointer-events-none disabled:cursor-not-allowed",
    m3StateLayer,
    m3FocusRing,
  ],
  {
    variants: {
      variant: {
        // SpaceUI names
        default: [
          "border-transparent bg-surface-container-high text-on-surface-variant",
          "disabled:bg-on-surface/12 disabled:text-on-surface/38",
        ],
        active: [
          "border-transparent bg-secondary-container text-on-secondary-container",
          "disabled:bg-on-surface/12 disabled:text-on-surface/38",
        ],
        accent: [
          "border-transparent bg-primary text-on-primary",
          "disabled:bg-on-surface/12 disabled:text-on-surface/38",
        ],
        solid: [
          "border-outline-variant bg-surface-container text-on-surface-variant",
          "disabled:border-on-surface/12 disabled:text-on-surface/38",
        ],
        // M3 names
        standard:
          "border-transparent bg-transparent text-on-surface-variant disabled:text-on-surface/38",
        filled: [
          "border-transparent bg-primary text-on-primary",
          "disabled:bg-on-surface/12 disabled:text-on-surface/38",
        ],
        tonal: [
          "border-transparent bg-secondary-container text-on-secondary-container",
          "disabled:bg-on-surface/12 disabled:text-on-surface/38",
        ],
        outlined: [
          "border-outline-variant bg-transparent text-on-surface-variant",
          "disabled:border-on-surface/12 disabled:text-on-surface/38",
        ],
      },
      // M3 icon button is 40 dp (`md`); `sm` is a density step, `lg` the 48 dp target size.
      size: {
        sm: "h-8 min-w-8",
        md: "h-10 min-w-10",
        lg: "h-12 min-w-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

const iconSizes = { sm: 18, md: 20, lg: 24 } as const;

export interface CircleButtonProps
  extends
    Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "size">,
    VariantProps<typeof circleButtonStyles> {
  /** Material Symbols name, element or icon component (a Phosphor component still works). */
  icon?: IconSource | React.ElementType;
  /** @deprecated Use variant="active" or variant="accent" instead */
  active?: boolean;
  /** @deprecated Use variant="accent" instead */
  activeAccent?: boolean;
}

export const CircleButton = forwardRef<HTMLButtonElement, CircleButtonProps>(
  (
    {
      icon,
      active,
      activeAccent,
      variant,
      size,
      className,
      children,
      type = "button",
      ...props
    },
    ref,
  ) => {
    // Resolve legacy active/activeAccent props to variant
    const resolvedVariant =
      variant ??
      (active && activeAccent ? "accent" : active ? "active" : "default");
    const iconSize = iconSizes[size ?? "md"];
    const selected =
      resolvedVariant === "active" || resolvedVariant === "accent";

    return (
      <button
        ref={ref}
        type={type}
        aria-pressed={active !== undefined ? selected : undefined}
        className={clsx(
          circleButtonStyles({
            variant: resolvedVariant,
            size,
          }),
          children && "w-auto gap-2 px-4",
          className,
        )}
        data-m3-component="CircleButton"
        {...props}
      >
        {icon !== undefined &&
          renderIcon(icon as IconSource, {
            size: iconSize,
            filled: selected || undefined,
            className: "shrink-0",
          })}
        {children && <span className="text-label-large">{children}</span>}
      </button>
    );
  },
);

CircleButton.displayName = "CircleButton";
