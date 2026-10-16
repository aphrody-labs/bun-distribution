"use client";

import * as React from "react";
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import { childRender, type PrimitiveProps } from "../lib/render";

import { cn } from "../lib/utils";

const DirectionContext = React.createContext<"top" | "bottom" | "left" | "right">("bottom");
function Drawer({
  direction = "bottom",
  dismissible = true,
  activeSnapPoint,
  setActiveSnapPoint,
  onClose,
  onOpenChange,
  children,
  ...props
}: PrimitiveProps<typeof DrawerPrimitive.Root> & {
  direction?: "top" | "bottom" | "left" | "right";
  dismissible?: boolean;
  activeSnapPoint?: number | string | null;
  setActiveSnapPoint?: (point: number | string | null) => void;
  onClose?: () => void;
}) {
  const swipe = { top: "up", bottom: "down", left: "left", right: "right" } as const;
  return (
    <DirectionContext.Provider value={direction}>
      <DrawerPrimitive.Root
        {...props}
        swipeDirection={swipe[direction]}
        disablePointerDismissal={!dismissible}
        snapPoint={activeSnapPoint}
        onSnapPointChange={setActiveSnapPoint}
        onOpenChange={(open, details) => {
          if (!dismissible && !open && ["outside-press", "escape-key", "swipe"].includes(details.reason)) {
            details.cancel();
            return;
          }
          onOpenChange?.(open, details);
        }}
        onOpenChangeComplete={open => {
          props.onOpenChangeComplete?.(open);
          if (!open) onClose?.();
        }}
      >
        {children}
      </DrawerPrimitive.Root>
    </DirectionContext.Provider>
  );
}

function DrawerTrigger({ asChild, children, ...props }: PrimitiveProps<typeof DrawerPrimitive.Trigger>) {
  return (
    <DrawerPrimitive.Trigger data-slot="drawer-trigger" render={childRender(asChild, children)} {...props}>
      {asChild ? undefined : children}
    </DrawerPrimitive.Trigger>
  );
}

function DrawerPortal({
  forceMount,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Portal> & { forceMount?: true }) {
  return <DrawerPrimitive.Portal keepMounted={forceMount} {...props} />;
}

function DrawerClose({ asChild, children, ...props }: PrimitiveProps<typeof DrawerPrimitive.Close>) {
  return (
    <DrawerPrimitive.Close data-slot="drawer-close" render={childRender(asChild, children)} {...props}>
      {asChild ? undefined : children}
    </DrawerPrimitive.Close>
  );
}

function DrawerOverlay({ className, ...props }: PrimitiveProps<typeof DrawerPrimitive.Backdrop>) {
  return (
    <DrawerPrimitive.Backdrop
      data-slot="drawer-overlay"
      className={cn(
        "motion-safe:data-open:animate-in motion-safe:data-closed:animate-out motion-safe:data-closed:fade-out-0 motion-safe:data-open:fade-in-0 fixed inset-0 z-50 bg-scrim/50 starting:opacity-0",
        className,
      )}
      {...props}
    />
  );
}

function DrawerContent({ className, children, ...props }: PrimitiveProps<typeof DrawerPrimitive.Popup>) {
  const direction = React.useContext(DirectionContext);
  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DrawerPrimitive.Viewport className="fixed inset-0 z-50">
        <DrawerPrimitive.Popup
          data-drawer-direction={direction}
          data-slot="drawer-content"
          className={cn(
            "group/drawer-content @container/drawer bg-background fixed z-50 flex h-auto flex-col",
            "data-[drawer-direction=top]:inset-x-0 data-[drawer-direction=top]:top-0 data-[drawer-direction=top]:mb-24 data-[drawer-direction=top]:max-h-[80vh] data-[drawer-direction=top]:rounded-b-lg data-[drawer-direction=top]:border-b",
            "data-[drawer-direction=bottom]:inset-x-0 data-[drawer-direction=bottom]:bottom-0 data-[drawer-direction=bottom]:mt-24 data-[drawer-direction=bottom]:max-h-[80vh] data-[drawer-direction=bottom]:rounded-t-lg data-[drawer-direction=bottom]:border-t",
            "data-[drawer-direction=right]:inset-y-0 data-[drawer-direction=right]:right-0 data-[drawer-direction=right]:w-3/4 data-[drawer-direction=right]:border-l data-[drawer-direction=right]:sm:max-w-sm",
            "data-[drawer-direction=left]:inset-y-0 data-[drawer-direction=left]:left-0 data-[drawer-direction=left]:w-3/4 data-[drawer-direction=left]:border-r data-[drawer-direction=left]:sm:max-w-sm",
            className,
          )}
          {...props}
        >
          <div className="bg-muted mx-auto mt-4 hidden h-2 w-[100px] shrink-0 rounded-full group-data-[drawer-direction=bottom]/drawer-content:block" />
          {children}
        </DrawerPrimitive.Popup>
      </DrawerPrimitive.Viewport>
    </DrawerPortal>
  );
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn(
        "flex flex-col gap-0.5 p-4 group-data-[drawer-direction=bottom]/drawer-content:text-center group-data-[drawer-direction=top]/drawer-content:text-center md:gap-1.5 md:text-left @md/drawer:items-start",
        className,
      )}
      {...props}
    />
  );
}

function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4 @md/drawer:flex-row @md/drawer:justify-end", className)}
      {...props}
    />
  );
}

function DrawerTitle({ className, ...props }: PrimitiveProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn("text-foreground font-semibold", className)}
      {...props}
    />
  );
}

function DrawerDescription({ className, ...props }: PrimitiveProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

export {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
};
