"use client";

import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import { type PrimitiveProps } from "../lib/render";

import { cn } from "../lib/utils";

function Progress({ className, value, ...props }: PrimitiveProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      value={value}
      data-slot="progress"
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-primary/20", className)}
      {...props}
    >
      <ProgressPrimitive.Track className="size-full">
        <ProgressPrimitive.Indicator
          data-slot="progress-indicator"
          className="h-full w-full flex-1 bg-primary transition-all"
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  );
}

export { Progress };
