"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type * as React from "react";

import { X } from "lucide-react";
import { cn } from "../lib/utils";
import { childRender } from "../lib/render";

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({
  asChild,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger> & { asChild?: boolean }) {
  return (
    <DialogPrimitive.Trigger
      data-slot="dialog-trigger"
      {...props}
      render={childRender(asChild, children) ?? props.render}
    >
      {asChild ? undefined : children}
    </DialogPrimitive.Trigger>
  );
}

function DialogPortal({
  forceMount,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal> & { forceMount?: boolean }) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} keepMounted={forceMount ?? props.keepMounted} />;
}

function DialogClose({
  asChild,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close> & { asChild?: boolean }) {
  return (
    <DialogPrimitive.Close data-slot="dialog-close" {...props} render={childRender(asChild, children) ?? props.render}>
      {asChild ? undefined : children}
    </DialogPrimitive.Close>
  );
}

function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Backdrop>) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={state =>
        cn(
          "fixed inset-0 z-50 bg-scrim/80 motion-safe:data-[open]:animate-in motion-safe:data-[closed]:animate-out motion-safe:data-[closed]:fade-out-0 motion-safe:data-[open]:fade-in-0 starting:opacity-0",
          typeof className === "function" ? className(state) : className,
        )
      }
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  forceMount,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Popup> & {
  showCloseButton?: boolean;
  forceMount?: boolean;
}) {
  return (
    <DialogPortal forceMount={forceMount}>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={state =>
          cn(
            "@container/dialog fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg motion-safe:duration-200 motion-safe:data-[open]:animate-in motion-safe:data-[closed]:animate-out motion-safe:data-[closed]:fade-out-0 motion-safe:data-[open]:fade-in-0 motion-safe:data-[closed]:zoom-out-95 motion-safe:data-[open]:zoom-in-95 motion-safe:data-[closed]:slide-out-to-left-1/2 motion-safe:data-[closed]:slide-out-to-top-[48%] motion-safe:data-[open]:slide-in-from-left-1/2 motion-safe:data-[open]:slide-in-from-top-[48%] sm:rounded-lg",
            typeof className === "function" ? className(state) : className,
          )
        }
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close className="absolute end-4 top-4 rounded-sm opacity-70 motion-safe:transition-opacity hover:opacity-100 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-hidden disabled:pointer-events-none data-[open]:bg-accent data-[open]:text-muted-foreground">
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        "flex flex-col space-y-1.5 text-center sm:text-left @md/dialog:flex-row @md/dialog:items-start @md/dialog:gap-4 @md/dialog:space-y-0",
        className,
      )}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 @md/dialog:flex-row @md/dialog:justify-end @md/dialog:space-x-2",
        className,
      )}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={state =>
        cn(
          "text-lg font-semibold leading-none tracking-tight",
          typeof className === "function" ? className(state) : className,
        )
      }
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={state =>
        cn("text-sm text-muted-foreground", typeof className === "function" ? className(state) : className)
      }
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
