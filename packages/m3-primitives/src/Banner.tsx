// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/Banner.tsx), MIT, rebuilt on Material Design 3.

import { clsx } from "clsx";
import { type VariantProps, cva } from "class-variance-authority";
import { forwardRef } from "react";

import { type IconSource, renderIcon } from "./Icon";

/**
 * Inline status banner: an M3 filled card (`rounded-medium`) on the variant's container role,
 * content in its `on-…-container` pair.
 */
const bannerVariants = cva("relative flex w-full items-center gap-3 rounded-medium px-4 py-3 text-body-medium", {
  variants: {
    variant: {
      default: "bg-surface-container-high text-on-surface",
      info: "bg-primary-container text-on-primary-container",
      success: "bg-success-container text-on-success-container",
      warning: "bg-warning-container text-on-warning-container",
      error: "bg-error-container text-on-error-container",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

const dotVariants = cva("size-2 shrink-0 rounded-full", {
  variants: {
    variant: {
      default: "bg-primary",
      info: "bg-primary",
      success: "bg-success",
      warning: "bg-warning",
      error: "bg-error",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

const bannerIcons = {
  default: "info",
  info: "info",
  success: "check_circle",
  warning: "warning",
  error: "cancel",
} as const;

export interface BannerProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof bannerVariants> {
  showDot?: boolean;
  /** Override the variant's icon (Material Symbols name, element or component); `null` hides it. */
  icon?: IconSource | React.ElementType;
}

const Banner = forwardRef<HTMLDivElement, BannerProps>(
  ({ className, variant, showDot = true, icon, children, ...props }, ref) => {
    const key = variant || "default";

    return (
      <div
        ref={ref}
        role="alert"
        className={clsx(bannerVariants({ variant }), className)}
        data-m3-component="Banner"
        {...props}
      >
        {showDot && <span className={clsx(dotVariants({ variant }))} />}
        {renderIcon((icon === undefined ? bannerIcons[key] : icon) as IconSource, {
          size: 20,
          className: clsx("shrink-0", key === "default" && "text-primary"),
        })}
        <div className="flex-1">{children}</div>
      </div>
    );
  },
);

Banner.displayName = "Banner";

export { Banner, bannerVariants };
