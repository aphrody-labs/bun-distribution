"use client";
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { useState } from "react";
import { Check, Minus } from "lucide-react";
import { childRender, type PrimitiveProps } from "../lib/render";
import { cn } from "../lib/utils";

type CheckedState = boolean | "indeterminate";
type CheckboxProps = Omit<
  PrimitiveProps<typeof CheckboxPrimitive.Root>,
  "checked" | "defaultChecked" | "onCheckedChange"
> & {
  checked?: CheckedState;
  defaultChecked?: CheckedState;
  onCheckedChange?: (checked: CheckedState) => void;
};
function Checkbox({ className, checked, defaultChecked, onCheckedChange, asChild, children, ...props }: CheckboxProps) {
  const [initialMixed, setInitialMixed] = useState(defaultChecked === "indeterminate");
  const mixed = checked === "indeterminate" || (checked === undefined && initialMixed);
  return (
    <CheckboxPrimitive.Root
      {...props}
      render={childRender(asChild, children)}
      checked={checked === undefined ? undefined : checked === true}
      defaultChecked={defaultChecked === true}
      indeterminate={mixed}
      onCheckedChange={next => {
        if (checked === undefined) setInitialMixed(false);
        onCheckedChange?.(next);
      }}
      data-slot="checkbox"
      className={cn(
        "peer size-4 shrink-0 rounded-sm border border-primary focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-hidden data-disabled:cursor-not-allowed data-disabled:opacity-50 data-checked:bg-primary data-checked:text-primary-foreground data-indeterminate:bg-primary data-indeterminate:text-primary-foreground",
        className,
      )}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current"
      >
        {mixed ? <Minus className="size-3.5" /> : <Check className="size-3.5" />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
export { Checkbox };
