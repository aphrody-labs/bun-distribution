"use client";

import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import type * as React from "react";

import { cn } from "../lib/utils";

function Slider({
  className,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      className={cn(
        "relative flex w-full touch-none select-none items-center",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full items-center">
        <SliderPrimitive.Track className="relative h-3 w-full grow overflow-hidden rounded-full border-2 border-black bg-black/60 shadow-inner">
          <SliderPrimitive.Indicator className="absolute h-full bg-gradient-to-r from-dbz-orange via-dbz-yellow to-dbz-ki" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="block size-6 rounded-full border-2 border-black bg-gradient-to-br from-amber-400 via-orange-500 to-amber-600 shadow-[2px_2px_0px_#000] outline-none cursor-grab transition-transform hover:scale-110 active:scale-95 active:cursor-grabbing focus-visible:ring-4 focus-visible:ring-dbz-yellow/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#121218]" />
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
