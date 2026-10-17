// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/Card.tsx), MIT, rebuilt on Material Design 3.

import { clsx } from "clsx";
import { forwardRef } from "react";

/**
 * M3 card variants (corner `medium`, 12 dp):
 * - `elevated`: `surface-container-low` at elevation 1,
 * - `filled`: `surface-container-highest`, no elevation,
 * - `outlined`: `surface` with a 1 dp `outline-variant` border.
 *
 * SpaceUI names: `default` is the elevated card (the upstream card had a shadow), `dark` the
 * outlined card on `surface` (the upstream `dark` card sat on the app background).
 */
type CardVariant = "default" | "dark" | "elevated" | "filled" | "outlined";

const elevated = "border border-transparent bg-surface-container-low shadow-md3-1";
const filled = "border border-transparent bg-surface-container-highest";
const outlined = "border border-outline-variant bg-surface";

const variantStyles: Record<CardVariant, string> = {
  default: elevated,
  dark: outlined,
  elevated,
  filled,
  outlined,
};

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

const Card = forwardRef<HTMLDivElement, CardProps>(({ className, variant = "default", ...props }, ref) => (
  <div
    ref={ref}
    className={clsx("rounded-medium text-on-surface", variantStyles[variant], className)}
    data-m3-component="Card"
    {...props}
  />
));

Card.displayName = "Card";

const CardHeader = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={clsx("flex flex-col gap-1 p-4", className)} data-m3-component="CardHeader" {...props} />
));

CardHeader.displayName = "CardHeader";

const CardTitle = forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, children, ...props }, ref) => (
    <h3
      ref={ref}
      className={clsx("text-title-large text-on-surface", className)}
      data-m3-component="CardTitle"
      {...props}
    >
      {children}
    </h3>
  ),
);

CardTitle.displayName = "CardTitle";

const CardDescription = forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      className={clsx("text-body-medium text-on-surface-variant", className)}
      data-m3-component="CardDescription"
      {...props}
    />
  ),
);

CardDescription.displayName = "CardDescription";

const CardContent = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={clsx("p-4 pt-0 text-body-medium", className)} data-m3-component="CardContent" {...props} />
));

CardContent.displayName = "CardContent";

const CardFooter = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={clsx("flex items-center gap-2 p-4 pt-0", className)}
    data-m3-component="CardFooter"
    {...props}
  />
));

CardFooter.displayName = "CardFooter";

export type { CardProps, CardVariant };
export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
