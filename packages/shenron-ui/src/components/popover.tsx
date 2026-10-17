"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import type * as React from "react";

import { cn } from "../lib/utils";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverPortal = PopoverPrimitive.Portal;
const PopoverClose = PopoverPrimitive.Close;

function PopoverPopup({
  className,
  children,
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Popup> & {
  sideOffset?: number;
}) {
  return (
    <PopoverPortal>
      <PopoverPrimitive.Positioner sideOffset={sideOffset} className="z-50 outline-none">
        <PopoverPrimitive.Popup
          className={cn(
            "relative z-50 w-72 rounded-xl border-2 border-black bg-[#0e0e14] p-4 text-gray-100 shadow-[4px_4px_0px_#000] outline-none select-none transition-all duration-150",
            "data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
            className,
          )}
          {...props}
        >
          <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-dbz-orange via-dbz-yellow to-dbz-orange rounded-t-lg" />
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPortal>
  );
}

function PopoverTitle({ className, ...props }: React.ComponentProps<typeof PopoverPrimitive.Title>) {
  return (
    <PopoverPrimitive.Title
      className={cn("font-saiyan text-lg font-bold tracking-wider text-white mb-2", className)}
      {...props}
    />
  );
}

function PopoverDescription({ className, ...props }: React.ComponentProps<typeof PopoverPrimitive.Description>) {
  return <PopoverPrimitive.Description className={cn("text-xs text-gray-300 leading-relaxed", className)} {...props} />;
}

export { Popover, PopoverTrigger, PopoverPortal, PopoverPopup, PopoverTitle, PopoverDescription, PopoverClose };
