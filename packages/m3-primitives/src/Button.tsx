// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/Button.tsx), MIT, rebuilt on Material Design 3.

"use client";

import { cva, cx, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";

import { m3FocusRing, m3StateLayer } from "./utils";

export type ButtonBaseProps = VariantProps<typeof buttonStyles>;

export type ButtonProps = ButtonBaseProps &
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    href?: undefined;
    /** Alias for `disabled` */
    loading?: boolean;
  };

export type LinkButtonProps = ButtonBaseProps &
  React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href?: string;
    /** Alias for `disabled` (applies disabled styling via className) */
    loading?: boolean;
  };

type Button = {
  (props: ButtonProps): React.ReactElement;
  (props: LinkButtonProps): React.ReactElement;
};

const hasHref = (
  props: ButtonProps | LinkButtonProps,
): props is LinkButtonProps => "href" in props;

// M3 common-button looks. Disabled: container on-surface 12 %, content on-surface 38 %.
const filled = [
  "border-transparent bg-primary text-on-primary hover:shadow-md3-1",
  "disabled:bg-on-surface/12 disabled:text-on-surface/38 disabled:shadow-none",
  m3StateLayer,
];
const tonal = [
  "border-transparent bg-secondary-container text-on-secondary-container hover:shadow-md3-1",
  "disabled:bg-on-surface/12 disabled:text-on-surface/38 disabled:shadow-none",
  m3StateLayer,
];
const outlined = [
  "border-outline-variant bg-transparent text-on-surface-variant",
  "disabled:border-on-surface/12 disabled:text-on-surface/38",
  m3StateLayer,
];
const text = [
  "border-transparent bg-transparent text-primary",
  "disabled:text-on-surface/38",
  m3StateLayer,
];
const elevated = [
  "border-transparent bg-surface-container-low text-primary shadow-md3-1 hover:shadow-md3-2",
  "disabled:bg-on-surface/12 disabled:text-on-surface/38 disabled:shadow-none",
  m3StateLayer,
];

export const buttonStyles = cva(
  [
    "inline-flex cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap border font-plain",
    "transition-[background-color,border-color,box-shadow,color] duration-200 ease-standard",
    "disabled:pointer-events-none disabled:cursor-not-allowed",
    m3FocusRing,
  ],
  {
    variants: {
      // M3 baseline height is 40 dp (`lg`); smaller sizes are density steps (-4 dp each).
      size: {
        icon: "size-8 !p-0",
        lg: "h-10 px-6 text-label-large",
        md: "h-9 px-5 text-label-large",
        sm: "h-8 px-4 text-label-large",
        xs: "h-7 px-3 text-label-medium",
      },
      variant: {
        // M3 names
        filled,
        tonal,
        outlined,
        text,
        elevated,
        // SpaceUI names, mapped onto the M3 looks
        default: tonal,
        gray: tonal,
        accent: filled,
        outline: outlined,
        subtle: text,
        dotted: [...outlined, "border-dashed"],
        /** Filled button whose container color comes from the caller (`className="bg-…"`). */
        colored: [
          "border-transparent text-on-primary shadow-md3-1",
          "disabled:bg-on-surface/12 disabled:text-on-surface/38 disabled:shadow-none",
          m3StateLayer,
        ],
        bare: "",
      },
      rounding: {
        none: "rounded-none",
        left: "rounded-l-full rounded-r-small",
        right: "rounded-l-small rounded-r-full",
        both: "rounded-full",
        full: "rounded-full",
        /** M3 Expressive square button shape. */
        square: "rounded-medium",
      },
    },
    defaultVariants: {
      size: "sm",
      variant: "default",
      rounding: "both",
    },
  },
);

export const Button = forwardRef<
  HTMLButtonElement | HTMLAnchorElement,
  ButtonProps | LinkButtonProps
>(({ className, loading, ...props }, ref) => {
  const isLink = hasHref(props);
  if (loading && !isLink) (props as ButtonProps).disabled = true;
  const { size, variant, rounding, children, ...rest } = props;
  className = cx(
    buttonStyles({ size, variant, rounding }),
    loading && isLink && "pointer-events-none opacity-38",
    className,
  );
  return isLink ? (
    <a
      data-m3-component="Button"
      {...(rest as LinkButtonProps)}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      ref={ref as any}
      className={cx(className, "no-underline")}
    >
      {children}
    </a>
  ) : (
    <button
      type="button"
      data-m3-component="Button"
      {...(rest as ButtonProps)}
      aria-busy={loading || undefined}
      ref={ref as any}
      className={className}
    >
      {children}
    </button>
  );
});

Button.displayName = "Button";

export { buttonStyles as buttonVariants };
