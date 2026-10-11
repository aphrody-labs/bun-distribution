"use client";
import type { ComponentProps } from "react";
import { Slot } from "../lib/render";
import { cn } from "../lib/utils";
function Label({ className, asChild, ...props }: ComponentProps<"label"> & { asChild?: boolean }) {
  const Component = asChild ? Slot : "label";
  return (
    <Component
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
export { Label };
