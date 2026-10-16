"use client";

import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import type * as React from "react";

import { cn } from "../lib/utils";

function Progress({
  className,
  value = 0,
  variant = "ki",
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
  variant?: "ki" | "saiyan" | "scouter";
}) {
  const variants = {
    ki: "bg-gradient-to-r from-dbz-orange via-dbz-yellow to-dbz-ki",
    saiyan: "bg-gradient-to-r from-blue-600 via-cyan-400 to-blue-300",
    scouter: "bg-gradient-to-r from-emerald-600 via-green-400 to-lime-300",
  };

  return (
    <ProgressPrimitive.Root
      value={value}
      className={cn(
        "relative h-4 w-full overflow-hidden rounded-full border-2 border-black bg-black/80 shadow-[2px_2px_0px_#000]",
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Track className="h-full w-full">
        <ProgressPrimitive.Indicator
          className={cn(
            "h-full transition-all duration-300 ease-out",
            variants[variant],
          )}
          style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%` }}
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  );
}

export { Progress };
