"use client";

import * as React from "react";
import { PreviewCard as HoverCardPrimitive } from "@base-ui/react/preview-card";

import { cn } from "../lib/utils";
import { childRender } from "../lib/render";

const HoverDelayContext = React.createContext({ openDelay: 700, closeDelay: 300 });

function HoverCard({
  openDelay = 700,
  closeDelay = 300,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Root> & {
  openDelay?: number;
  closeDelay?: number;
}) {
  const delays = React.useMemo(() => ({ openDelay, closeDelay }), [openDelay, closeDelay]);
  return (
    <HoverDelayContext.Provider value={delays}>
      <HoverCardPrimitive.Root data-slot="hover-card" {...props} />
    </HoverDelayContext.Provider>
  );
}

function HoverCardTrigger({
  asChild,
  children,
  delay,
  closeDelay,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Trigger> & { asChild?: boolean }) {
  const defaults = React.useContext(HoverDelayContext);
  return (
    <HoverCardPrimitive.Trigger
      data-slot="hover-card-trigger"
      {...props}
      delay={delay ?? defaults.openDelay}
      closeDelay={closeDelay ?? defaults.closeDelay}
      render={childRender(asChild, children) ?? props.render}
    >
      {asChild ? undefined : children}
    </HoverCardPrimitive.Trigger>
  );
}

function HoverCardContent({
  className,
  align = "center",
  sideOffset = 4,
  side,
  alignOffset,
  anchor,
  collisionBoundary,
  collisionPadding,
  forceMount,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Popup> &
  Pick<
    React.ComponentProps<typeof HoverCardPrimitive.Positioner>,
    "align" | "sideOffset" | "side" | "alignOffset" | "anchor" | "collisionBoundary" | "collisionPadding"
  > & { forceMount?: boolean }) {
  return (
    <HoverCardPrimitive.Portal data-slot="hover-card-portal" keepMounted={forceMount}>
      <HoverCardPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        anchor={anchor}
        collisionBoundary={collisionBoundary}
        collisionPadding={collisionPadding}
        className="z-50"
      >
        <HoverCardPrimitive.Popup
          data-slot="hover-card-content"
          className={state =>
            cn(
              "z-50 w-64 origin-(--transform-origin) rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[closed]:animate-out data-[closed]:fade-out-0 data-[closed]:zoom-out-95 data-[open]:animate-in data-[open]:fade-in-0 data-[open]:zoom-in-95",
              typeof className === "function" ? className(state) : className,
            )
          }
          {...props}
        />
      </HoverCardPrimitive.Positioner>
    </HoverCardPrimitive.Portal>
  );
}

export { HoverCard, HoverCardTrigger, HoverCardContent };
