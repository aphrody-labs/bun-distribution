"use client";

import * as React from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import { cn } from "../lib/utils";
import { childRender, Slot } from "../lib/render";

type Anchor = React.ComponentProps<typeof PopoverPrimitive.Positioner>["anchor"];
const AnchorContext = React.createContext<{
  anchor: Anchor;
  setAnchor: React.Dispatch<React.SetStateAction<Anchor>>;
} | null>(null);

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  const [anchor, setAnchor] = React.useState<Anchor>(null);
  const context = React.useMemo(() => ({ anchor, setAnchor }), [anchor]);
  return (
    <AnchorContext.Provider value={context}>
      <PopoverPrimitive.Root data-slot="popover" {...props} />
    </AnchorContext.Provider>
  );
}

function PopoverTrigger({
  asChild,
  children,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger> & { asChild?: boolean }) {
  return (
    <PopoverPrimitive.Trigger
      data-slot="popover-trigger"
      {...props}
      render={childRender(asChild, children) ?? props.render}
    >
      {asChild ? undefined : children}
    </PopoverPrimitive.Trigger>
  );
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  side,
  alignOffset,
  anchor,
  collisionBoundary,
  collisionPadding,
  forceMount,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Popup> &
  Pick<
    React.ComponentProps<typeof PopoverPrimitive.Positioner>,
    "align" | "sideOffset" | "side" | "alignOffset" | "anchor" | "collisionBoundary" | "collisionPadding"
  > & { forceMount?: boolean }) {
  const context = React.useContext(AnchorContext);
  return (
    <PopoverPrimitive.Portal keepMounted={forceMount}>
      <PopoverPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        anchor={anchor ?? context?.anchor}
        collisionBoundary={collisionBoundary}
        collisionPadding={collisionPadding}
        className="z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={state =>
            cn(
              "z-50 w-72 origin-(--transform-origin) rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[closed]:animate-out data-[closed]:fade-out-0 data-[closed]:zoom-out-95 data-[open]:animate-in data-[open]:fade-in-0 data-[open]:zoom-in-95",
              typeof className === "function" ? className(state) : className,
            )
          }
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

function PopoverAnchor({
  asChild,
  virtualRef,
  ref,
  ...props
}: React.ComponentProps<"div"> & {
  asChild?: boolean;
  virtualRef?: React.RefObject<{ getBoundingClientRect: () => DOMRect } | null>;
}) {
  const setAnchor = React.useContext(AnchorContext)?.setAnchor;
  const mergedRef = React.useCallback(
    (element: HTMLDivElement | null) => {
      setAnchor?.(virtualRef?.current ?? element);
      const cleanup = typeof ref === "function" ? ref(element) : undefined;
      if (ref && typeof ref !== "function") ref.current = element;
      return () => {
        setAnchor?.(null);
        if (typeof cleanup === "function") cleanup();
        else if (typeof ref === "function") ref(null);
        else if (ref) ref.current = null;
      };
    },
    [setAnchor, virtualRef, ref],
  );
  const Component = asChild ? Slot : "div";
  return <Component data-slot="popover-anchor" {...props} ref={mergedRef} />;
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="popover-header" className={cn("flex flex-col gap-1 text-sm", className)} {...props} />;
}

function PopoverTitle({ className, ...props }: React.ComponentProps<typeof PopoverPrimitive.Title>) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={state => cn("font-medium", typeof className === "function" ? className(state) : className)}
      {...props}
    />
  );
}

function PopoverDescription({ className, ...props }: React.ComponentProps<typeof PopoverPrimitive.Description>) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={state => cn("text-muted-foreground", typeof className === "function" ? className(state) : className)}
      {...props}
    />
  );
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor, PopoverHeader, PopoverTitle, PopoverDescription };
