"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import type * as React from "react";

import { cn } from "../lib/utils";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

function DialogBackdrop({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Backdrop>) {
  return (
    <DialogPrimitive.Backdrop
      className={cn(
        "fixed inset-0 z-50 bg-black/80 backdrop-blur-sm transition-all duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
        className,
      )}
      {...props}
    />
  );
}

function DialogPopup({
  className,
  children,
  variant = "toriyama",
  closeLabel = "Close",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Popup> & {
  variant?: "toriyama" | "capsule" | "scouter";
  /** Localized accessible name supplied by the host. */
  closeLabel?: string;
}) {
  const variantStyles = {
    toriyama: "border-3 border-black bg-[#0d0d12] shadow-[6px_6px_0px_#000] text-gray-100",
    capsule:
      "border-2 border-dbz-blue-light/60 bg-[#080d1a] shadow-[0_0_25px_rgba(0,180,255,0.25)] text-white rounded-3xl",
    scouter:
      "border-2 border-green-500/80 bg-[#061208]/95 shadow-[0_0_20px_rgba(34,197,94,0.3)] text-green-300 font-mono",
  };

  return (
    <DialogPortal>
      <DialogBackdrop />
      <DialogPrimitive.Viewport className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4 sm:p-6">
        <DialogPrimitive.Popup
          className={cn(
            "relative w-full max-w-lg rounded-2xl p-6 sm:p-8 transition-all duration-200 outline-none",
            "data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
            variantStyles[variant],
            className,
          )}
          {...props}
        >
          {/* Dragon Ball Top Glow Aura */}
          {variant === "toriyama" && (
            <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-dbz-orange via-dbz-yellow to-dbz-orange rounded-t-xl" />
          )}
          {children}
          <DialogPrimitive.Close
            aria-label={closeLabel}
            className="absolute top-4 right-4 inline-flex size-11 items-center justify-center rounded-lg border-2 border-black bg-black/60 text-white/70 shadow-[2px_2px_0px_#000] transition-all hover:bg-dbz-orange hover:text-black active:translate-x-px active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dbz-yellow"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Viewport>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col space-y-2 text-center sm:text-left mb-6", className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-3 gap-2 mt-6 pt-4 border-t border-black/40",
        className,
      )}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn(
        "font-saiyan text-2xl sm:text-3xl text-white tracking-wider uppercase drop-shadow-[0_2px_8px_rgba(255,107,0,0.3)]",
        className,
      )}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-sm text-gray-300 leading-relaxed font-sans", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogBackdrop,
  DialogPopup,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
