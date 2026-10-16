"use client";
import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion";
import { ChevronDownIcon } from "lucide-react";
import { childRender, type PrimitiveProps } from "../lib/render";
import { cn } from "../lib/utils";
type Selection =
  | {
      type: "single";
      value?: string;
      defaultValue?: string;
      onValueChange?: (value: string) => void;
      collapsible?: boolean;
    }
  | {
      type: "multiple";
      value?: string[];
      defaultValue?: string[];
      onValueChange?: (value: string[]) => void;
      collapsible?: boolean;
    };
type AccordionProps = Omit<
  PrimitiveProps<typeof AccordionPrimitive.Root>,
  "value" | "defaultValue" | "onValueChange" | "multiple"
> &
  Selection;
function selectionArray(input: string | string[] | undefined) {
  return input === undefined ? undefined : Array.isArray(input) ? input : input ? [input] : [];
}
function Accordion({
  asChild,
  children,
  type,
  value,
  defaultValue,
  onValueChange,
  collapsible = false,
  ...props
}: AccordionProps) {
  return (
    <AccordionPrimitive.Root
      {...props}
      data-slot="accordion"
      multiple={type === "multiple"}
      value={selectionArray(value)}
      defaultValue={selectionArray(defaultValue)}
      render={childRender(asChild, children)}
      onValueChange={(next: string[], details) => {
        if (type === "single") {
          if (!collapsible && next.length === 0) {
            details.cancel();
            return;
          }
          (onValueChange as ((value: string) => void) | undefined)?.(next[0] ?? "");
        } else (onValueChange as ((value: string[]) => void) | undefined)?.(next);
      }}
    >
      {asChild ? undefined : children}
    </AccordionPrimitive.Root>
  );
}
function AccordionItem({ className, asChild, children, ...props }: PrimitiveProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      render={childRender(asChild, children)}
      className={cn("border-b last:border-b-0", className)}
      {...props}
    >
      {asChild ? undefined : children}
    </AccordionPrimitive.Item>
  );
}
function AccordionTrigger({
  className,
  asChild,
  children,
  ...props
}: PrimitiveProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        render={childRender(asChild, children)}
        className={cn(
          "focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-start justify-between gap-4 rounded-md py-4 text-left text-sm font-medium transition-all outline-hidden hover:underline focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&[data-panel-open]>svg]:rotate-180",
          className,
        )}
        {...props}
      >
        {asChild ? undefined : (
          <>
            {children}
            <ChevronDownIcon className="text-muted-foreground pointer-events-none size-4 shrink-0 translate-y-0.5 transition-transform duration-200" />
          </>
        )}
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}
function AccordionContent({
  className,
  children,
  forceMount,
  asChild,
  ...props
}: PrimitiveProps<typeof AccordionPrimitive.Panel> & { forceMount?: true }) {
  return (
    <AccordionPrimitive.Panel
      data-slot="accordion-content"
      keepMounted={forceMount}
      render={childRender(asChild, children)}
      className="data-closed:animate-accordion-up data-open:animate-accordion-down overflow-hidden text-sm"
      {...props}
    >
      {asChild ? undefined : <div className={cn("pt-0 pb-4", className)}>{children}</div>}
    </AccordionPrimitive.Panel>
  );
}
export { Accordion, AccordionContent, AccordionItem, AccordionTrigger };
