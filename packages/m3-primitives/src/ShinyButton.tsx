// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/ShinyButton.tsx), MIT, rebuilt on Material Design 3.

"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { type ComponentProps, type ReactNode } from "react";

import { type IconSource, renderIcon } from "./Icon";
import { m3FocusRing, m3StateLayer } from "./utils";

/**
 * The SpaceUI call-to-action: a filled button whose container is a `primary` → `tertiary`
 * gradient with a `primary` glow. Content is `on-primary`; shape, height and states are M3.
 */
const shinyButtonVariants = cva(
  [
    "inline-flex flex-row items-center justify-center gap-x-2 overflow-hidden rounded-full",
    "bg-linear-to-br from-primary to-tertiary text-on-primary",
    "will-change-transform",
    "transition-[box-shadow,transform] duration-200 ease-standard active:scale-[0.98]",
    "cursor-pointer disabled:pointer-events-none disabled:cursor-not-allowed",
    "disabled:bg-none disabled:bg-on-surface/12 disabled:text-on-surface/38 disabled:shadow-none",
    m3StateLayer,
    m3FocusRing,
  ],
  {
    variants: {
      size: {
        default: "h-12 pe-6 ps-4",
        small: "h-10 pe-4 ps-3",
      },
      glow: {
        lg: "shadow-[0_0_2.5rem_color-mix(in_srgb,var(--color-primary)_50%,transparent)] hover:shadow-[0_0_3.5rem_color-mix(in_srgb,var(--color-primary)_70%,transparent)]",
        sm: "shadow-[0_0.125rem_1.25rem_color-mix(in_srgb,var(--color-primary)_40%,transparent)] hover:shadow-[0_0.25rem_2rem_color-mix(in_srgb,var(--color-primary)_60%,transparent)]",
        none: "hover:shadow-md3-1",
      },
    },
    defaultVariants: {
      size: "default",
      glow: "lg",
    },
  },
);

type BaseShinyButtonProps = VariantProps<typeof shinyButtonVariants> & {
  /** Material Symbols name, element or icon component. Default `arrow_circle_down`. */
  icon?: IconSource | React.ElementType;
  children: ReactNode;
  className?: string;
};

type ShinyButtonAsButton = BaseShinyButtonProps &
  Omit<ComponentProps<"button">, "size"> & {
    href?: never;
  };

type ShinyButtonAsLink = BaseShinyButtonProps &
  Omit<ComponentProps<"a">, "size"> & {
    href: string;
  };

export type ShinyButtonProps = ShinyButtonAsButton | ShinyButtonAsLink;

export function ShinyButton({
  icon = "arrow_circle_down",
  size,
  glow,
  children,
  className,
  href,
  ...props
}: ShinyButtonProps) {
  const iconSize = size === "small" ? 18 : 22;

  const content = (
    <>
      {renderIcon(icon as IconSource, {
        size: iconSize,
        className: "shrink-0",
      })}
      <span className={clsx("text-center font-plain", size === "small" ? "text-label-large" : "text-title-medium")}>
        {children}
      </span>
    </>
  );

  const classes = clsx(shinyButtonVariants({ size, glow }), className);

  if (href) {
    return (
      <a {...(props as ComponentProps<"a">)} href={href} className={classes}>
        {content}
      </a>
    );
  }

  return (
    <button type="button" {...(props as ComponentProps<"button">)} className={classes}>
      {content}
    </button>
  );
}
