// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/InfoBanner.tsx), MIT, rebuilt on Material Design 3.

import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { type ReactNode } from "react";

import { type IconSource, renderIcon } from "./Icon";

/** An M3 filled card on the variant's container role; text inherits the `on-` pair. */
const infoBannerStyles = cva("relative mb-6 overflow-hidden rounded-medium", {
  variants: {
    variant: {
      info: "bg-primary-container text-on-primary-container",
      gray: "bg-surface-container-high text-on-surface",
      warning: "bg-warning-container text-on-warning-container",
      danger: "bg-error-container text-on-error-container",
    },
  },
  defaultVariants: {
    variant: "info",
  },
});

const infoBannerIconStyles = cva("mt-0.5 flex shrink-0", {
  variants: {
    variant: {
      info: "text-on-primary-container",
      gray: "text-on-surface-variant",
      warning: "text-on-warning-container",
      danger: "text-on-error-container",
    },
  },
  defaultVariants: {
    variant: "info",
  },
});

interface InfoBannerProps extends VariantProps<typeof infoBannerStyles> {
  /** Material Symbols name, element or icon component. */
  icon: IconSource | React.ElementType;
  children: ReactNode;
  className?: string;
}

export function InfoBanner({
  icon,
  children,
  variant,
  className,
}: InfoBannerProps) {
  return (
    <div role="note" className={clsx(infoBannerStyles({ variant }), className)}>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className={infoBannerIconStyles({ variant })}>
            {renderIcon(icon as IconSource, { size: 20 })}
          </div>
          <div>{children}</div>
        </div>
      </div>
    </div>
  );
}

export function InfoBannerText({ children }: { children: ReactNode }) {
  return <p className="text-body-medium">{children}</p>;
}

export function InfoBannerSubtext({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-body-small">{children}</p>;
}
