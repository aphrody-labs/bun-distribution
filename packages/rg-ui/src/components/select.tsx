"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import * as React from "react";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { childRender, type PrimitiveProps } from "../lib/render";

type SelectProps = Omit<SelectPrimitive.Root.Props<string>, "onValueChange"> & {
  onValueChange?: (value: string, details: SelectPrimitive.Root.ChangeEventDetails) => void;
};

function collectItems(children: React.ReactNode, items: Record<string, React.ReactNode>) {
  React.Children.forEach(children, child => {
    if (!React.isValidElement<{ value?: string; children?: React.ReactNode }>(child)) return;
    if (child.type === SelectItem && typeof child.props.value === "string")
      items[child.props.value] = child.props.children;
    else collectItems(child.props.children, items);
  });
}

function Select({ children, items, value, defaultValue, onValueChange, ...props }: SelectProps) {
  const labels: Record<string, React.ReactNode> = {};
  if (!items) collectItems(children, labels);
  return (
    <SelectPrimitive.Root
      {...props}
      items={items ?? labels}
      value={value === "" ? null : value}
      defaultValue={defaultValue === "" ? null : defaultValue}
      onValueChange={(next, details) => onValueChange?.(next ?? "", details)}
    >
      {children}
    </SelectPrimitive.Root>
  );
}

function SelectGroup({ className, ...props }: PrimitiveProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" className={className} {...props} />;
}

function SelectValue({ className, ...props }: PrimitiveProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" className={className} {...props} />;
}

function SelectTrigger({
  className,
  size = "default",
  children,
  asChild,
  render,
  nativeButton,
  ...props
}: PrimitiveProps<typeof SelectPrimitive.Trigger> & { size?: "sm" | "default" }) {
  const child = childRender(asChild, children);
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "border-input data-[placeholder]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 aria-invalid:border-destructive flex w-fit items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs outline-hidden focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:size-4",
        className,
      )}
      {...props}
      nativeButton={nativeButton ?? (!child || child.type === "button")}
      render={child ?? render}
    >
      {asChild ? undefined : (
        <>
          {children}
          <SelectPrimitive.Icon>
            <ChevronDownIcon className="size-4 opacity-50" />
          </SelectPrimitive.Icon>
        </>
      )}
    </SelectPrimitive.Trigger>
  );
}

type SelectContentProps = PrimitiveProps<typeof SelectPrimitive.Popup> &
  Pick<
    React.ComponentProps<typeof SelectPrimitive.Positioner>,
    "side" | "align" | "sideOffset" | "alignOffset" | "collisionPadding" | "collisionBoundary"
  > & { position?: "popper" | "item-aligned" };

function SelectContent({
  className,
  children,
  position = "popper",
  side,
  align,
  sideOffset = 4,
  alignOffset,
  collisionPadding,
  collisionBoundary,
  ...props
}: SelectContentProps) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        className="z-50"
        alignItemWithTrigger={position === "item-aligned"}
        {...{ side, align, sideOffset, alignOffset, collisionPadding, collisionBoundary }}
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            "bg-popover text-popover-foreground data-[open]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[open]:fade-in-0 data-[closed]:zoom-out-95 data-[open]:zoom-in-95 relative max-h-(--available-height) min-w-[8rem] min-w-(--anchor-width) origin-(--transform-origin) overflow-hidden rounded-md border shadow-md",
            className,
          )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List className="overflow-y-auto p-1">{children}</SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({ className, ...props }: PrimitiveProps<typeof SelectPrimitive.GroupLabel>) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn("text-muted-foreground px-2 py-1.5 text-xs", className)}
      {...props}
    />
  );
}

function SelectItem({ className, children, ...props }: PrimitiveProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4",
        className,
      )}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({ className, ...props }: PrimitiveProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("bg-border pointer-events-none -mx-1 my-1 h-px", className)}
      {...props}
    />
  );
}

function SelectScrollUpButton({ className, ...props }: PrimitiveProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn("flex cursor-default items-center justify-center py-1", className)}
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpArrow>
  );
}

function SelectScrollDownButton({ className, ...props }: PrimitiveProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn("flex cursor-default items-center justify-center py-1", className)}
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownArrow>
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
