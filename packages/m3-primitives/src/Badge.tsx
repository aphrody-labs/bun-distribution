// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/Badge.tsx), MIT, rebuilt on Material Design 3.

import { clsx } from "clsx";
import { type VariantProps, cva } from "class-variance-authority";

/**
 * Status / tag label. Every SpaceUI variant is an M3 assist-chip look (`rounded-small`, container
 * role + its `on-` pair); `badge` is the M3 badge proper (`error` / `on-error`, full shape).
 */
const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-small border font-plain transition-colors duration-200 ease-standard",
  {
    variants: {
      variant: {
        default: "border-outline-variant bg-surface-container-high text-on-surface-variant",
        secondary: "border-transparent bg-secondary-container text-on-secondary-container",
        outline: "border-outline-variant bg-transparent text-on-surface-variant",
        accent: "border-transparent bg-primary-container text-on-primary-container",
        success: "border-transparent bg-success-container text-on-success-container",
        warning: "border-transparent bg-warning-container text-on-warning-container",
        error: "border-transparent bg-error-container text-on-error-container",
        destructive: "border-transparent bg-error-container text-on-error-container",
        info: "border-transparent bg-primary-container text-on-primary-container",
        // M3 names
        tertiary: "border-transparent bg-tertiary-container text-on-tertiary-container",
        badge: "justify-center rounded-full border-transparent bg-error text-on-error",
      },
      size: {
        sm: "h-4 min-w-4 px-1 text-label-small",
        default: "h-5 px-1.5 text-label-small",
        md: "h-6 px-2 text-label-medium",
        /** M3 chip height (32 dp). */
        lg: "h-8 px-3 text-label-large",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return (
    <div
      className={clsx(badgeVariants({ variant, size }), className)}
      data-m3-component="Badge"
      {...props}
    />
  );
}

export { Badge, badgeVariants };
