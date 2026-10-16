"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import type * as React from "react";

import { cn } from "../lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;
const TooltipPortal = TooltipPrimitive.Portal;

function TooltipPopup({
  className,
  sideOffset = 6,
  variant = "comic",
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Popup> & {
  sideOffset?: number;
  variant?: "comic" | "scouter" | "ki";
}) {
  const variantStyles = {
    comic:
      "border-2 border-black bg-white text-black font-extrabold shadow-[2px_2px_0px_#000] text-xs uppercase tracking-wide",
    scouter:
      "border border-green-500/80 bg-[#061408]/95 text-green-300 font-mono text-[11px] shadow-[0_0_12px_rgba(34,197,94,0.3)] tracking-wider",
    ki: "border-2 border-black bg-[#121018] text-dbz-orange font-bold text-xs shadow-[2.5px_2.5px_0px_#000]",
  };

  return (
    <TooltipPortal>
      <TooltipPrimitive.Positioner sideOffset={sideOffset} className="z-50">
        <TooltipPrimitive.Popup
          className={cn(
            "relative z-50 rounded-lg px-3 py-1.5 transition-all duration-150 outline-none select-none",
            "data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
            variantStyles[variant],
            className,
          )}
          {...props}
        />
      </TooltipPrimitive.Positioner>
    </TooltipPortal>
  );
}

export {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipPortal,
  TooltipPopup,
};
