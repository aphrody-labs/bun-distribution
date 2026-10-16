// SPDX-License-Identifier: Apache-2.0 AND MIT
// Material Design 3 Drawer / Sheet primitive built on Base UI (@base-ui/react/drawer).
"use client";

import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import { clsx } from "clsx";
import { forwardRef } from "react";

import { type AsChildProp, asChildProps, withClassName } from "./base-ui";

export type DrawerRootProps = DrawerPrimitive.Root.Props;
export const DrawerRoot = DrawerPrimitive.Root;

export type DrawerTriggerProps = DrawerPrimitive.Trigger.Props & AsChildProp;
export const DrawerTrigger = forwardRef<HTMLButtonElement, DrawerTriggerProps>(
  ({ className, children, asChild, ...props }, ref) => {
    const child = asChildProps(asChild, children);
    return (
      <DrawerPrimitive.Trigger
        ref={ref}
        className={withClassName("", className)}
        render={child.render}
        nativeButton={child.nativeButton}
        {...props}
      >
        {child.render ? undefined : children}
      </DrawerPrimitive.Trigger>
    );
  },
);
DrawerTrigger.displayName = "DrawerTrigger";

export type DrawerPortalProps = DrawerPrimitive.Portal.Props;
export const DrawerPortal = DrawerPrimitive.Portal;

export type DrawerBackdropProps = DrawerPrimitive.Backdrop.Props;
export const DrawerBackdrop = forwardRef<HTMLDivElement, DrawerBackdropProps>(
  ({ className, ...props }, ref) => (
    <DrawerPrimitive.Backdrop
      ref={ref}
      className={withClassName(
        clsx(
          "fixed inset-0 z-50 bg-scrim/38 backdrop-blur-xs transition-opacity duration-300 ease-standard",
          "data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
        ),
        className,
      )}
      {...props}
    />
  ),
);
DrawerBackdrop.displayName = "DrawerBackdrop";

export type DrawerPopupProps = DrawerPrimitive.Popup.Props & {
  side?: "bottom" | "left" | "right";
};

export const DrawerPopup = forwardRef<HTMLDivElement, DrawerPopupProps>(
  ({ className, children, side = "bottom", ...props }, ref) => {
    const sideStyles = {
      bottom:
        "fixed inset-x-0 bottom-0 max-h-[90vh] rounded-t-extra-large border-t border-outline-variant/30 data-[starting-style]:translate-y-full data-[ending-style]:translate-y-full",
      left: "fixed inset-y-0 left-0 w-80 max-w-[85vw] rounded-r-large border-r border-outline-variant/30 data-[starting-style]:-translate-x-full data-[ending-style]:-translate-x-full",
      right:
        "fixed inset-y-0 right-0 w-80 max-w-[85vw] rounded-l-large border-l border-outline-variant/30 data-[starting-style]:translate-x-full data-[ending-style]:translate-x-full",
    }[side];

    return (
      <DrawerPrimitive.Popup
        ref={ref}
        className={withClassName(
          clsx(
            "z-50 bg-surface-container p-6 shadow-elevation-3 text-on-surface outline-none",
            "transition-transform duration-300 ease-emphasized",
            sideStyles,
          ),
          className,
        )}
        {...props}
      >
        {side === "bottom" && (
          <div className="mx-auto -mt-3 mb-4 h-1 w-8 rounded-full bg-outline-variant" />
        )}
        {children}
      </DrawerPrimitive.Popup>
    );
  },
);
DrawerPopup.displayName = "DrawerPopup";

export type DrawerTitleProps = DrawerPrimitive.Title.Props;
export const DrawerTitle = forwardRef<HTMLHeadingElement, DrawerTitleProps>(
  ({ className, ...props }, ref) => (
    <DrawerPrimitive.Title
      ref={ref}
      className={withClassName(
        "m-0 text-title-large font-semibold text-on-surface",
        className,
      )}
      {...props}
    />
  ),
);
DrawerTitle.displayName = "DrawerTitle";

export type DrawerDescriptionProps = DrawerPrimitive.Description.Props;
export const DrawerDescription = forwardRef<
  HTMLParagraphElement,
  DrawerDescriptionProps
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Description
    ref={ref}
    className={withClassName(
      "m-0 text-body-medium text-on-surface-variant",
      className,
    )}
    {...props}
  />
));
DrawerDescription.displayName = "DrawerDescription";

export type DrawerCloseProps = DrawerPrimitive.Close.Props & AsChildProp;
export const DrawerClose = forwardRef<HTMLButtonElement, DrawerCloseProps>(
  ({ className, children, asChild, ...props }, ref) => {
    const child = asChildProps(asChild, children);
    return (
      <DrawerPrimitive.Close
        ref={ref}
        className={withClassName("", className)}
        render={child.render}
        nativeButton={child.nativeButton}
        {...props}
      >
        {child.render ? undefined : children}
      </DrawerPrimitive.Close>
    );
  },
);
DrawerClose.displayName = "DrawerClose";

export const Drawer = {
  Root: DrawerRoot,
  Trigger: DrawerTrigger,
  Portal: DrawerPortal,
  Backdrop: DrawerBackdrop,
  Popup: DrawerPopup,
  Title: DrawerTitle,
  Description: DrawerDescription,
  Close: DrawerClose,
};
