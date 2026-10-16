"use client";
import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { childRender, type PrimitiveProps } from "../lib/render";
function Collapsible({ asChild, children, ...props }: PrimitiveProps<typeof CollapsiblePrimitive.Root>) {
  return (
    <CollapsiblePrimitive.Root data-slot="collapsible" render={childRender(asChild, children)} {...props}>
      {asChild ? undefined : children}
    </CollapsiblePrimitive.Root>
  );
}
function CollapsibleTrigger({ asChild, children, ...props }: PrimitiveProps<typeof CollapsiblePrimitive.Trigger>) {
  return (
    <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" render={childRender(asChild, children)} {...props}>
      {asChild ? undefined : children}
    </CollapsiblePrimitive.Trigger>
  );
}
function CollapsibleContent({
  asChild,
  children,
  forceMount,
  ...props
}: PrimitiveProps<typeof CollapsiblePrimitive.Panel> & { forceMount?: true }) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-content"
      keepMounted={forceMount}
      render={childRender(asChild, children)}
      {...props}
    >
      {asChild ? undefined : children}
    </CollapsiblePrimitive.Panel>
  );
}
export { Collapsible, CollapsibleContent, CollapsibleTrigger };
