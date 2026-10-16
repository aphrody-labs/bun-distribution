"use client";

import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import * as React from "react";

import { buttonVariants } from "./button";
import { cn } from "../lib/utils";
import { childRender } from "../lib/render";

const CancelFocusContext = React.createContext<React.RefObject<HTMLElement | null> | null>(null);

function AlertDialog({ ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  const cancelRef = React.useRef<HTMLElement | null>(null);
  return (
    <CancelFocusContext.Provider value={cancelRef}>
      <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
    </CancelFocusContext.Provider>
  );
}

function AlertDialogTrigger({
  asChild,
  children,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Trigger> & { asChild?: boolean }) {
  return (
    <AlertDialogPrimitive.Trigger
      data-slot="alert-dialog-trigger"
      {...props}
      render={childRender(asChild, children) ?? props.render}
    >
      {asChild ? undefined : children}
    </AlertDialogPrimitive.Trigger>
  );
}

function AlertDialogPortal({
  forceMount,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Portal> & { forceMount?: boolean }) {
  return (
    <AlertDialogPrimitive.Portal
      data-slot="alert-dialog-portal"
      {...props}
      keepMounted={forceMount ?? props.keepMounted}
    />
  );
}

function AlertDialogOverlay({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Backdrop>) {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-overlay"
      className={state =>
        cn(
          "fixed inset-0 z-50 bg-scrim/80 motion-safe:data-[open]:animate-in motion-safe:data-[closed]:animate-out motion-safe:data-[closed]:fade-out-0 motion-safe:data-[open]:fade-in-0",
          typeof className === "function" ? className(state) : className,
        )
      }
      {...props}
    />
  );
}

function AlertDialogContent({
  className,
  initialFocus,
  forceMount,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Popup> & { forceMount?: boolean }) {
  const cancelRef = React.useContext(CancelFocusContext);
  return (
    <AlertDialogPortal forceMount={forceMount}>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Popup
        data-slot="alert-dialog-content"
        initialFocus={initialFocus ?? (() => cancelRef?.current ?? true)}
        className={state =>
          cn(
            "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg motion-safe:duration-200 motion-safe:data-[open]:animate-in motion-safe:data-[closed]:animate-out motion-safe:data-[closed]:fade-out-0 motion-safe:data-[open]:fade-in-0 motion-safe:data-[closed]:zoom-out-95 motion-safe:data-[open]:zoom-in-95 motion-safe:data-[closed]:slide-out-to-left-1/2 motion-safe:data-[closed]:slide-out-to-top-[48%] motion-safe:data-[open]:slide-in-from-left-1/2 motion-safe:data-[open]:slide-in-from-top-[48%] sm:rounded-lg",
            typeof className === "function" ? className(state) : className,
          )
        }
        {...props}
      />
    </AlertDialogPortal>
  );
}

function AlertDialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn("flex flex-col space-y-2 text-center sm:text-left", className)}
      {...props}
    />
  );
}

function AlertDialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
      {...props}
    />
  );
}

function AlertDialogTitle({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={state => cn("text-lg font-semibold", typeof className === "function" ? className(state) : className)}
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={state =>
        cn("text-sm text-muted-foreground", typeof className === "function" ? className(state) : className)
      }
      {...props}
    />
  );
}

function AlertDialogAction({
  className,
  asChild,
  children,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Close> & { asChild?: boolean }) {
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-action"
      className={state => cn(buttonVariants(), typeof className === "function" ? className(state) : className)}
      {...props}
      render={childRender(asChild, children) ?? props.render}
    >
      {asChild ? undefined : children}
    </AlertDialogPrimitive.Close>
  );
}

function AlertDialogCancel({
  className,
  asChild,
  children,
  ref,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Close> & { asChild?: boolean }) {
  const cancelRef = React.useContext(CancelFocusContext);
  const mergedRef = React.useCallback(
    (element: HTMLButtonElement | null) => {
      if (cancelRef) cancelRef.current = element;
      const cleanup = typeof ref === "function" ? ref(element) : undefined;
      if (ref && typeof ref !== "function") ref.current = element;
      return () => {
        if (cancelRef) cancelRef.current = null;
        if (typeof cleanup === "function") cleanup();
        else if (typeof ref === "function") ref(null);
        else if (ref) ref.current = null;
      };
    },
    [cancelRef, ref],
  );
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-cancel"
      className={state =>
        cn(
          buttonVariants({ variant: "outline" }),
          "mt-2 sm:mt-0",
          typeof className === "function" ? className(state) : className,
        )
      }
      {...props}
      ref={mergedRef}
      render={childRender(asChild, children) ?? props.render}
    >
      {asChild ? undefined : children}
    </AlertDialogPrimitive.Close>
  );
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
};
