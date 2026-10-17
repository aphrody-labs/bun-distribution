"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import type * as React from "react";

import { cn } from "../lib/utils";

const Select = SelectPrimitive.Root;
const SelectGroup = SelectPrimitive.Group;
const SelectPortal = SelectPrimitive.Portal;

function SelectTrigger({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "inline-flex h-10 w-full items-center justify-between rounded-xl border-2 border-black bg-[#121218] px-3.5 py-2 text-xs font-semibold uppercase tracking-wider text-gray-100 shadow-[2.5px_2.5px_0px_#000] outline-none transition-all",
        "hover:border-dbz-orange/70 hover:shadow-[3.5px_3.5px_0px_#000] active:translate-x-px active:translate-y-px active:shadow-none focus-visible:border-dbz-orange focus-visible:ring-2 focus-visible:ring-dbz-orange/30",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon className="text-white/60">
        <ChevronDown className="size-4" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectValue({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value className={cn("line-clamp-1 text-left font-medium", className)} {...props} />;
}

function SelectPopup({
  className,
  children,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Popup> & {
  sideOffset?: number;
}) {
  return (
    <SelectPortal>
      <SelectPrimitive.Positioner sideOffset={sideOffset} className="z-50 outline-none">
        <SelectPrimitive.Popup
          className={cn(
            "relative z-50 max-h-72 min-w-[var(--anchor-width)] overflow-y-auto rounded-xl border-2 border-black bg-[#0d0d14] p-1.5 text-gray-100 shadow-[5px_5px_0px_#000] outline-none transition-all select-none",
            "data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
            className,
          )}
          {...props}
        >
          <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-dbz-orange via-dbz-yellow to-dbz-orange" />
          <SelectPrimitive.List className="space-y-0.5">{children}</SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPortal>
  );
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex cursor-pointer select-none items-center rounded-lg py-2 pl-9 pr-3 text-xs font-semibold uppercase tracking-wider outline-none transition-colors",
        "data-[highlighted]:bg-dbz-orange data-[highlighted]:text-black text-gray-200",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2.5 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-3.5 stroke-[3]" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.GroupLabel>) {
  return (
    <SelectPrimitive.GroupLabel
      className={cn(
        "px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-dbz-yellow/80",
        className,
      )}
      {...props}
    />
  );
}

function SelectSeparator({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      className={cn("-mx-1 my-1.5 h-0.5 bg-black/60 border-b border-white/5", className)}
      {...props}
    />
  );
}

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectPortal,
  SelectPopup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
};
