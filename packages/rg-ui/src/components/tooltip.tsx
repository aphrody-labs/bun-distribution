"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import * as React from "react";

import { cn } from "../lib/utils";
import { childRender } from "../lib/render";

const TooltipDelayContext = React.createContext<number | null>(null);

function TooltipProvider({
  delayDuration = 0,
  skipDelayDuration,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider> & {
  delayDuration?: number;
  skipDelayDuration?: number;
}) {
  return (
    <TooltipDelayContext.Provider value={props.delay ?? delayDuration}>
      <TooltipPrimitive.Provider
        data-slot="tooltip-provider"
        {...props}
        delay={props.delay ?? delayDuration}
        timeout={skipDelayDuration ?? props.timeout}
      >
        {children}
      </TooltipPrimitive.Provider>
    </TooltipDelayContext.Provider>
  );
}

function Tooltip({
  delayDuration,
  disableHoverableContent,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root> & {
  delayDuration?: number;
  disableHoverableContent?: boolean;
}) {
  const providerDelay = React.useContext(TooltipDelayContext);
  const root = (
    <TooltipDelayContext.Provider value={delayDuration ?? providerDelay ?? 0}>
      <TooltipPrimitive.Root
        data-slot="tooltip"
        {...props}
        disableHoverablePopup={disableHoverableContent ?? props.disableHoverablePopup}
      />
    </TooltipDelayContext.Provider>
  );
  return providerDelay === null ? <TooltipProvider>{root}</TooltipProvider> : root;
}

function TooltipTrigger({
  asChild,
  children,
  delay,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger> & { asChild?: boolean }) {
  const defaultDelay = React.useContext(TooltipDelayContext);
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      {...props}
      delay={delay ?? defaultDelay ?? 0}
      render={childRender(asChild, children) ?? props.render}
    >
      {asChild ? undefined : children}
    </TooltipPrimitive.Trigger>
  );
}

function TooltipContent({
  className,
  sideOffset = 0,
  side,
  align,
  alignOffset,
  anchor,
  collisionBoundary,
  collisionPadding,
  forceMount,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Popup> &
  Pick<
    React.ComponentProps<typeof TooltipPrimitive.Positioner>,
    "side" | "align" | "alignOffset" | "sideOffset" | "anchor" | "collisionBoundary" | "collisionPadding"
  > & { forceMount?: boolean }) {
  return (
    <TooltipPrimitive.Portal keepMounted={forceMount}>
      <TooltipPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        anchor={anchor}
        collisionBoundary={collisionBoundary}
        collisionPadding={collisionPadding}
        className="z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={state =>
            cn(
              "bg-primary text-primary-foreground motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:data-[closed]:animate-out motion-safe:data-[closed]:fade-out-0 motion-safe:data-[closed]:zoom-out-95 motion-safe:data-[side=bottom]:slide-in-from-top-2 motion-safe:data-[side=left]:slide-in-from-right-2 motion-safe:data-[side=right]:slide-in-from-left-2 motion-safe:data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--transform-origin) rounded-md px-3 py-1.5 text-xs text-balance",
              typeof className === "function" ? className(state) : className,
            )
          }
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow className="bg-primary fill-primary z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
