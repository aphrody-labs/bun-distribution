"use client";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { CircleIcon } from "lucide-react";
import { childRender, type PrimitiveProps } from "../lib/render";
import { cn } from "../lib/utils";
type RadioGroupProps = Omit<PrimitiveProps<typeof RadioGroupPrimitive>, "value" | "defaultValue" | "onValueChange"> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  orientation?: "horizontal" | "vertical";
  loop?: boolean;
};
function RadioGroup({
  className,
  asChild,
  children,
  orientation,
  loop = true,
  onKeyDownCapture,
  ...props
}: RadioGroupProps) {
  return (
    <RadioGroupPrimitive<string>
      data-slot="radio-group"
      aria-orientation={orientation}
      render={childRender(asChild, children)}
      className={cn("grid gap-2", className)}
      onKeyDownCapture={event => {
        onKeyDownCapture?.(event);
        if (event.defaultPrevented || !event.key.startsWith("Arrow")) return;
        const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
        if (orientation && horizontal !== (orientation === "horizontal")) {
          event.preventDefault();
          return;
        }
        if (!loop) {
          const radios = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]:not([data-disabled])')];
          const index = radios.indexOf(event.target as HTMLElement);
          const backwards = event.key === "ArrowLeft" || event.key === "ArrowUp";
          if ((backwards && index === 0) || (!backwards && index === radios.length - 1)) event.preventDefault();
        }
      }}
      {...props}
    >
      {asChild ? undefined : children}
    </RadioGroupPrimitive>
  );
}
function RadioGroupItem({ className, asChild, children, ...props }: PrimitiveProps<typeof RadioPrimitive.Root>) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group-item"
      render={childRender(asChild, children)}
      className={cn(
        "aspect-square size-4 rounded-full border border-primary text-primary focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-hidden data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <RadioPrimitive.Indicator data-slot="radio-group-indicator" className="flex items-center justify-center">
        <CircleIcon className="size-2.5 fill-current text-current" />
      </RadioPrimitive.Indicator>
    </RadioPrimitive.Root>
  );
}
export { RadioGroup, RadioGroupItem };
