// SPDX-License-Identifier: Apache-2.0 AND MIT
// Material Design 3 AlertDialog primitive built on Base UI (@base-ui/react/alert-dialog).
"use client";

import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { clsx } from "clsx";
import { forwardRef } from "react";

import { type AsChildProp, asChildProps, withClassName } from "./base-ui";
import { Button } from "./Button";

export type AlertDialogRootProps = AlertDialogPrimitive.Root.Props;
export const AlertDialogRoot = AlertDialogPrimitive.Root;

export type AlertDialogTriggerProps = AlertDialogPrimitive.Trigger.Props & AsChildProp;
export const AlertDialogTrigger = forwardRef<HTMLButtonElement, AlertDialogTriggerProps>(
  ({ className, children, asChild, ...props }, ref) => {
    const child = asChildProps(asChild, children);
    return (
      <AlertDialogPrimitive.Trigger
        ref={ref}
        className={withClassName("", className)}
        render={child.render}
        nativeButton={child.nativeButton}
        {...props}
      >
        {child.render ? undefined : children}
      </AlertDialogPrimitive.Trigger>
    );
  },
);
AlertDialogTrigger.displayName = "AlertDialogTrigger";

export type AlertDialogPortalProps = AlertDialogPrimitive.Portal.Props;
export const AlertDialogPortal = AlertDialogPrimitive.Portal;

export type AlertDialogBackdropProps = AlertDialogPrimitive.Backdrop.Props;
export const AlertDialogBackdrop = forwardRef<HTMLDivElement, AlertDialogBackdropProps>(
  ({ className, ...props }, ref) => (
    <AlertDialogPrimitive.Backdrop
      ref={ref}
      className={withClassName(
        clsx(
          "fixed inset-0 z-50 bg-scrim/38 backdrop-blur-xs transition-opacity duration-200 ease-standard",
          "data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
        ),
        className,
      )}
      {...props}
    />
  ),
);
AlertDialogBackdrop.displayName = "AlertDialogBackdrop";

export type AlertDialogPopupProps = AlertDialogPrimitive.Popup.Props;
export const AlertDialogPopup = forwardRef<HTMLDivElement, AlertDialogPopupProps>(
  ({ className, children, ...props }, ref) => (
    <AlertDialogPrimitive.Popup
      ref={ref}
      className={withClassName(
        clsx(
          "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
          "w-full max-w-[calc(100vw-3rem)] sm:max-w-lg",
          "rounded-extra-large bg-surface-container-high p-6 shadow-elevation-3",
          "flex flex-col gap-4 text-on-surface outline-none",
          "transition-[opacity,transform] duration-200 ease-emphasized",
          "data-[ending-style]:scale-90 data-[ending-style]:opacity-0",
          "data-[starting-style]:scale-90 data-[starting-style]:opacity-0",
        ),
        className,
      )}
      {...props}
    >
      {children}
    </AlertDialogPrimitive.Popup>
  ),
);
AlertDialogPopup.displayName = "AlertDialogPopup";

export type AlertDialogTitleProps = AlertDialogPrimitive.Title.Props;
export const AlertDialogTitle = forwardRef<HTMLHeadingElement, AlertDialogTitleProps>(
  ({ className, ...props }, ref) => (
    <AlertDialogPrimitive.Title
      ref={ref}
      className={withClassName("m-0 text-headline-small font-semibold text-on-surface", className)}
      {...props}
    />
  ),
);
AlertDialogTitle.displayName = "AlertDialogTitle";

export type AlertDialogDescriptionProps = AlertDialogPrimitive.Description.Props;
export const AlertDialogDescription = forwardRef<HTMLParagraphElement, AlertDialogDescriptionProps>(
  ({ className, ...props }, ref) => (
    <AlertDialogPrimitive.Description
      ref={ref}
      className={withClassName("m-0 text-body-medium text-on-surface-variant", className)}
      {...props}
    />
  ),
);
AlertDialogDescription.displayName = "AlertDialogDescription";

export type AlertDialogCloseProps = AlertDialogPrimitive.Close.Props & AsChildProp;
export const AlertDialogClose = forwardRef<HTMLButtonElement, AlertDialogCloseProps>(
  ({ className, children, asChild, ...props }, ref) => {
    const child = asChildProps(asChild, children);
    return (
      <AlertDialogPrimitive.Close
        ref={ref}
        className={withClassName("", className)}
        render={child.render}
        nativeButton={child.nativeButton}
        {...props}
      >
        {child.render ? undefined : children}
      </AlertDialogPrimitive.Close>
    );
  },
);
AlertDialogClose.displayName = "AlertDialogClose";

export interface AlertDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm?: () => void;
  children?: React.ReactNode;
}

/** Pre-composed M3 confirmation dialog with confirm and cancel buttons. */
export function AlertDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  children,
}: AlertDialogProps) {
  return (
    <AlertDialogRoot open={open} onOpenChange={onOpenChange}>
      {children && <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>}
      <AlertDialogPortal>
        <AlertDialogBackdrop />
        <AlertDialogPopup>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
          <div className="mt-2 flex justify-end gap-2">
            <AlertDialogClose asChild>
              <Button variant="text" size="md">
                {cancelLabel}
              </Button>
            </AlertDialogClose>
            <AlertDialogClose asChild>
              <Button
                variant="filled"
                size="md"
                className={destructive ? "bg-error text-on-error hover:bg-error/90" : undefined}
                onClick={onConfirm}
              >
                {confirmLabel}
              </Button>
            </AlertDialogClose>
          </div>
        </AlertDialogPopup>
      </AlertDialogPortal>
    </AlertDialogRoot>
  );
}

AlertDialog.Root = AlertDialogRoot;
AlertDialog.Trigger = AlertDialogTrigger;
AlertDialog.Portal = AlertDialogPortal;
AlertDialog.Backdrop = AlertDialogBackdrop;
AlertDialog.Popup = AlertDialogPopup;
AlertDialog.Title = AlertDialogTitle;
AlertDialog.Description = AlertDialogDescription;
AlertDialog.Close = AlertDialogClose;
