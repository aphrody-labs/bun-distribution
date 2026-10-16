import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "../lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-md border-2 border-black/80 bg-clip-padding px-2 py-0.5 text-xs font-bold uppercase tracking-wider whitespace-nowrap transition-transform active:translate-x-[1px] active:translate-y-[1px] focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground border-black [a&]:hover:bg-primary/90",
        secondary:
          "bg-secondary text-secondary-foreground border-black/60 [a&]:hover:bg-secondary/90",
        outline:
          "border-current bg-background text-foreground [a&]:hover:bg-muted [a&]:hover:text-foreground",
        destructive:
          "border-destructive bg-destructive/15 text-destructive [a&]:hover:bg-destructive/25 dark:bg-destructive/25 dark:[a&]:hover:bg-destructive/35",
        success:
          "border-green-600 bg-green-500/15 text-green-400 [a&]:hover:bg-success/25 dark:bg-green-500/25 dark:[a&]:hover:bg-green-500/35",
        warning:
          "border-amber-500 bg-amber-500/15 text-amber-400 [a&]:hover:bg-warning/25 dark:bg-amber-500/25 dark:[a&]:hover:bg-amber-500/35",
        dragonball:
          "border-2 border-black bg-gradient-to-r from-dbz-orange to-amber-500 text-black font-extrabold",
        saiyan:
          "border-2 border-black bg-gradient-to-r from-amber-400 to-dbz-yellow text-black font-extrabold",
        scouter:
          "border border-green-500/90 bg-[#061408] text-green-300 font-mono tracking-widest",
        capsule:
          "border-2 border-dbz-blue-light/70 bg-[#081224] text-dbz-blue-light font-bold",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant, className }))}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
