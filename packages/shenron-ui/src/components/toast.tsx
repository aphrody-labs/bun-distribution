"use client";

import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import { X } from "lucide-react";
import type * as React from "react";

import { cn } from "../lib/utils";

const ToastProvider = ToastPrimitive.Provider;
const ToastPortal = ToastPrimitive.Portal;

function ToastViewport({ className, ...props }: React.ComponentProps<typeof ToastPrimitive.Viewport>) {
  return (
    <ToastPortal>
      <ToastPrimitive.Viewport
        className={cn(
          "fixed bottom-4 right-4 z-50 flex max-h-screen w-full max-w-sm flex-col-reverse gap-2 p-4 outline-none",
          className,
        )}
        {...props}
      />
    </ToastPortal>
  );
}

function ToastRoot({
  className,
  variant = "scouter",
  children,
  closeLabel = "Close",
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Root> & {
  variant?: "scouter" | "shenron" | "warning" | "danger";
  /** Localized accessible name supplied by the host. */
  closeLabel?: string;
}) {
  const variants = {
    scouter:
      "border-2 border-green-500/80 bg-[#061408]/95 text-green-300 font-mono shadow-[0_0_15px_rgba(34,197,94,0.3)]",
    shenron: "border-2 border-black bg-[#0e0e14] text-gray-100 shadow-[4px_4px_0px_#000]",
    warning: "border-2 border-amber-500/90 bg-[#140e06] text-amber-200 shadow-[0_0_15px_rgba(245,158,11,0.3)]",
    danger: "border-2 border-red-600 bg-[#160608] text-red-200 shadow-[0_0_15px_rgba(220,38,38,0.3)]",
  };

  return (
    <ToastPrimitive.Root
      className={cn(
        "relative flex w-full items-start gap-3 overflow-hidden rounded-xl p-4 transition-all duration-200 select-none",
        "data-[ending-style]:translate-y-2 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-2 data-[starting-style]:opacity-0",
        variants[variant],
        className,
      )}
      {...props}
    >
      {variant === "shenron" && (
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-dbz-orange via-dbz-yellow to-dbz-orange" />
      )}
      {children}
      <ToastPrimitive.Close
        aria-label={closeLabel}
        className="-m-2 ml-auto inline-flex size-11 shrink-0 items-center justify-center rounded transition-opacity hover:opacity-75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dbz-yellow"
      >
        <X className="size-4" />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  );
}

function ToastTitle({ className, ...props }: React.ComponentProps<typeof ToastPrimitive.Title>) {
  return <ToastPrimitive.Title className={cn("text-xs font-bold uppercase tracking-wider", className)} {...props} />;
}

function ToastDescription({ className, ...props }: React.ComponentProps<typeof ToastPrimitive.Description>) {
  return (
    <ToastPrimitive.Description className={cn("text-xs leading-relaxed opacity-90 font-sans", className)} {...props} />
  );
}

export { ToastProvider, ToastViewport, ToastRoot, ToastTitle, ToastDescription };
