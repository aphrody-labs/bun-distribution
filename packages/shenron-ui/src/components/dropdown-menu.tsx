"use client";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { Check } from "lucide-react";
import type * as React from "react";

import { cn } from "../lib/utils";

const DropdownMenu = MenuPrimitive.Root;
const DropdownMenuTrigger = MenuPrimitive.Trigger;
const DropdownMenuGroup = MenuPrimitive.Group;
const DropdownMenuPortal = MenuPrimitive.Portal;
const DropdownMenuSub = MenuPrimitive.SubmenuRoot;
const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup;

function DropdownMenuPopup({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Popup> & {
  sideOffset?: number;
}) {
  return (
    <DropdownMenuPortal>
      <MenuPrimitive.Positioner sideOffset={sideOffset} className="z-50 outline-none">
        <MenuPrimitive.Popup
          className={cn(
            "relative z-50 min-w-[12rem] overflow-hidden rounded-xl border-2 border-black bg-[#0d0d12] p-1.5 text-gray-100 shadow-[4px_4px_0px_#000] outline-none transition-all duration-150 select-none",
            "data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
            className,
          )}
          {...props}
        >
          <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-dbz-orange via-dbz-yellow to-dbz-orange" />
          {props.children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </DropdownMenuPortal>
  );
}

function DropdownMenuItem({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Item> & {
  variant?: "default" | "destructive" | "saiyan";
}) {
  const variants = {
    default:
      "text-gray-200 hover:bg-white/10 hover:text-white data-[highlighted]:bg-white/10 data-[highlighted]:text-white",
    destructive:
      "text-red-400 hover:bg-red-500/20 hover:text-red-300 data-[highlighted]:bg-red-500/20 data-[highlighted]:text-red-300",
    saiyan:
      "text-dbz-yellow hover:bg-dbz-orange hover:text-black data-[highlighted]:bg-dbz-orange data-[highlighted]:text-black font-bold",
  };

  return (
    <MenuPrimitive.Item
      className={cn(
        "relative flex cursor-pointer select-none items-center gap-2 rounded-lg px-3 py-2 text-xs font-sans font-semibold uppercase tracking-wider outline-none transition-colors",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.CheckboxItem>) {
  return (
    <MenuPrimitive.CheckboxItem
      checked={checked}
      className={cn(
        "relative flex cursor-pointer select-none items-center rounded-lg py-2 pl-9 pr-3 text-xs font-semibold uppercase tracking-wider outline-none transition-colors data-[highlighted]:bg-white/10",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2.5 flex size-4 items-center justify-center rounded border border-black bg-black/60 text-dbz-orange">
        <MenuPrimitive.CheckboxItemIndicator>
          <Check className="size-3 stroke-[3]" />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof MenuPrimitive.Separator>) {
  return (
    <MenuPrimitive.Separator
      className={cn("-mx-1.5 my-1.5 h-0.5 bg-black/60 border-b border-white/5", className)}
      {...props}
    />
  );
}

function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof MenuPrimitive.GroupLabel>) {
  return (
    <MenuPrimitive.GroupLabel
      className={cn(
        "px-3 py-1 text-[10px] font-mono uppercase tracking-[0.2em] text-dbz-yellow/80 font-bold",
        className,
      )}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuPopup,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuRadioGroup,
};
