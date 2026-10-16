"use client";

import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import type * as React from "react";

import { XIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { childRender } from "../lib/render";

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({
  asChild,
  children,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger> & { asChild?: boolean }) {
  return (
    <SheetPrimitive.Trigger
      data-slot="sheet-trigger"
      {...props}
      render={childRender(asChild, children) ?? props.render}
    >
      {asChild ? undefined : children}
    </SheetPrimitive.Trigger>
  );
}

function SheetClose({
  asChild,
  children,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close> & { asChild?: boolean }) {
  return (
    <SheetPrimitive.Close data-slot="sheet-close" {...props} render={childRender(asChild, children) ?? props.render}>
      {asChild ? undefined : children}
    </SheetPrimitive.Close>
  );
}

function SheetPortal({
  forceMount,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal> & { forceMount?: boolean }) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} keepMounted={forceMount ?? props.keepMounted} />;
}

function SheetOverlay({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Backdrop>) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={state =>
        cn(
          "motion-safe:data-[open]:animate-in motion-safe:data-[closed]:animate-out motion-safe:data-[closed]:fade-out-0 motion-safe:data-[open]:fade-in-0 fixed inset-0 z-50 bg-scrim/50 starting:opacity-0",
          typeof className === "function" ? className(state) : className,
        )
      }
      {...props}
    />
  );
}

function SheetContent({
  className,
  children,
  side = "right",
  forceMount,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Popup> & {
  side?: "top" | "right" | "bottom" | "left";
  forceMount?: boolean;
}) {
  return (
    <SheetPortal forceMount={forceMount}>
      <SheetOverlay />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        className={state =>
          cn(
            "@container/sheet bg-background motion-safe:data-[open]:animate-in motion-safe:data-[closed]:animate-out fixed z-50 flex flex-col gap-4 shadow-lg motion-safe:transition motion-safe:ease-in-out motion-safe:data-[closed]:duration-300 motion-safe:data-[open]:duration-500",
            side === "right" &&
              "motion-safe:data-[closed]:slide-out-to-right motion-safe:data-[open]:slide-in-from-right inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm",
            side === "left" &&
              "motion-safe:data-[closed]:slide-out-to-left motion-safe:data-[open]:slide-in-from-left inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm",
            side === "top" &&
              "motion-safe:data-[closed]:slide-out-to-top motion-safe:data-[open]:slide-in-from-top inset-x-0 top-0 h-auto border-b",
            side === "bottom" &&
              "motion-safe:data-[closed]:slide-out-to-bottom motion-safe:data-[open]:slide-in-from-bottom inset-x-0 bottom-0 h-auto border-t",
            typeof className === "function" ? className(state) : className,
          )
        }
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="data-[open]:bg-secondary absolute top-4 end-4 rounded-xs opacity-70 motion-safe:transition-opacity hover:opacity-100 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-hidden disabled:pointer-events-none">
          <XIcon className="size-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Popup>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 p-4 @md/sheet:items-start", className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4 @md/sheet:flex-row @md/sheet:justify-end", className)}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={state =>
        cn("text-foreground font-semibold", typeof className === "function" ? className(state) : className)
      }
      {...props}
    />
  );
}

function SheetDescription({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={state =>
        cn("text-muted-foreground text-sm", typeof className === "function" ? className(state) : className)
      }
      {...props}
    />
  );
}

export { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger };
