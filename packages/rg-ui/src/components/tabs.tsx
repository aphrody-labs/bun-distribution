"use client";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { createContext, useContext } from "react";
import { childRender, type PrimitiveProps } from "../lib/render";
import { cn } from "../lib/utils";
const ActivationContext = createContext(true);
type TabsProps = Omit<PrimitiveProps<typeof TabsPrimitive.Root>, "value" | "defaultValue" | "onValueChange"> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  activationMode?: "automatic" | "manual";
};
function Tabs({ activationMode = "automatic", asChild, children, onValueChange, ...props }: TabsProps) {
  return (
    <ActivationContext.Provider value={activationMode === "automatic"}>
      <TabsPrimitive.Root
        data-slot="tabs"
        render={childRender(asChild, children)}
        onValueChange={value => {
          if (typeof value === "string") onValueChange?.(value);
        }}
        {...props}
      >
        {asChild ? undefined : children}
      </TabsPrimitive.Root>
    </ActivationContext.Provider>
  );
}
function TabsList({
  className,
  asChild,
  children,
  loop,
  ...props
}: PrimitiveProps<typeof TabsPrimitive.List> & { loop?: boolean }) {
  const automatic = useContext(ActivationContext);
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      activateOnFocus={automatic}
      loopFocus={loop}
      render={childRender(asChild, children)}
      className={cn(
        "inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
        className,
      )}
      {...props}
    >
      {asChild ? undefined : children}
    </TabsPrimitive.List>
  );
}
function TabsTrigger({ className, asChild, children, ...props }: PrimitiveProps<typeof TabsPrimitive.Tab>) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      render={childRender(asChild, children)}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium motion-safe:transition-all focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-hidden disabled:pointer-events-none disabled:opacity-50 data-active:bg-background data-active:text-foreground data-active:shadow-sm",
        className,
      )}
      {...props}
    >
      {asChild ? undefined : children}
    </TabsPrimitive.Tab>
  );
}
function TabsContent({
  className,
  asChild,
  children,
  forceMount,
  ...props
}: PrimitiveProps<typeof TabsPrimitive.Panel> & { forceMount?: true }) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      keepMounted={forceMount}
      render={childRender(asChild, children)}
      className={cn(
        "mt-2 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-hidden",
        className,
      )}
      {...props}
    >
      {asChild ? undefined : children}
    </TabsPrimitive.Panel>
  );
}
export { Tabs, TabsContent, TabsList, TabsTrigger };
