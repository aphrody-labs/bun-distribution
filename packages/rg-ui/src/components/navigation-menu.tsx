"use client";

import { NavigationMenu as Primitive } from "@base-ui/react/navigation-menu";
import * as React from "react";
import { cva } from "class-variance-authority";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { childRender, type PrimitiveProps } from "../lib/render";

const ViewportMode = React.createContext(true);

function NavigationMenu({
  className,
  children,
  viewport = true,
  ...props
}: PrimitiveProps<typeof Primitive.Root> & { viewport?: boolean }) {
  return (
    <ViewportMode.Provider value={viewport}>
      <Primitive.Root
        data-slot="navigation-menu"
        data-viewport={viewport}
        className={cn("group/navigation-menu relative flex max-w-max flex-1 items-center justify-center", className)}
        {...props}
      >
        {children}
        <NavigationMenuViewport />
      </Primitive.Root>
    </ViewportMode.Provider>
  );
}

function NavigationMenuList({ className, ...props }: PrimitiveProps<typeof Primitive.List>) {
  return (
    <Primitive.List
      data-slot="navigation-menu-list"
      className={cn("group flex flex-1 list-none items-center justify-center gap-1", className)}
      {...props}
    />
  );
}

function NavigationMenuItem({ className, ...props }: PrimitiveProps<typeof Primitive.Item>) {
  return <Primitive.Item data-slot="navigation-menu-item" className={cn("relative", className)} {...props} />;
}

const navigationMenuTriggerStyle = cva(
  "group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium outline-hidden hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[popup-open]:bg-accent/50 data-[popup-open]:text-accent-foreground",
);

function NavigationMenuTrigger({
  className,
  children,
  asChild,
  render,
  nativeButton,
  ...props
}: PrimitiveProps<typeof Primitive.Trigger>) {
  const child = childRender(asChild, children);
  return (
    <Primitive.Trigger
      data-slot="navigation-menu-trigger"
      className={cn(navigationMenuTriggerStyle(), "group", className)}
      {...props}
      nativeButton={nativeButton ?? (!child || child.type === "button")}
      render={child ?? render}
    >
      {asChild ? undefined : (
        <>
          {children}
          <Primitive.Icon>
            <ChevronDownIcon
              className="ml-1 size-3 transition duration-300 group-data-[popup-open]:rotate-180"
              aria-hidden="true"
            />
          </Primitive.Icon>
        </>
      )}
    </Primitive.Trigger>
  );
}

function NavigationMenuContent({ className, ...props }: PrimitiveProps<typeof Primitive.Content>) {
  return (
    <Primitive.Content
      data-slot="navigation-menu-content"
      className={cn(
        "w-full p-2 pr-2.5 data-[open]:animate-in data-[closed]:animate-out data-[activation-direction=left]:slide-in-from-left-2 data-[activation-direction=right]:slide-in-from-right-2",
        className,
      )}
      {...props}
    />
  );
}

function NavigationMenuViewport({ className, ...props }: PrimitiveProps<typeof Primitive.Viewport>) {
  const viewport = React.useContext(ViewportMode);
  return (
    <Primitive.Portal>
      <Primitive.Positioner className="z-50" sideOffset={6} align={viewport ? "center" : "start"}>
        <Primitive.Popup className="origin-(--transform-origin) h-(--popup-height) w-(--popup-width) overflow-hidden rounded-md border bg-popover text-popover-foreground shadow data-[closed]:animate-out data-[closed]:zoom-out-95 data-[open]:animate-in data-[open]:zoom-in-95">
          <Primitive.Viewport data-slot="navigation-menu-viewport" className={cn("relative", className)} {...props} />
        </Primitive.Popup>
      </Primitive.Positioner>
    </Primitive.Portal>
  );
}

function NavigationMenuLink({
  className,
  children,
  asChild,
  render,
  closeOnClick = true,
  ...props
}: PrimitiveProps<typeof Primitive.Link>) {
  return (
    <Primitive.Link
      data-slot="navigation-menu-link"
      closeOnClick={closeOnClick}
      className={cn(
        "flex flex-col gap-1 rounded-sm p-2 text-sm outline-hidden hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[active]:bg-accent/50 data-[active]:text-accent-foreground [&_svg]:size-4",
        className,
      )}
      {...props}
      render={childRender(asChild, children) ?? render}
    >
      {asChild ? undefined : children}
    </Primitive.Link>
  );
}

function NavigationMenuIndicator({ className, ...props }: PrimitiveProps<typeof Primitive.Arrow>) {
  return (
    <Primitive.Arrow
      data-slot="navigation-menu-indicator"
      className={cn("flex h-1.5 items-end justify-center overflow-hidden", className)}
      {...props}
    >
      <div className="relative top-[60%] size-2 rotate-45 rounded-tl-sm bg-border shadow-md" />
    </Primitive.Arrow>
  );
}

export {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuContent,
  NavigationMenuTrigger,
  NavigationMenuLink,
  NavigationMenuIndicator,
  NavigationMenuViewport,
  navigationMenuTriggerStyle,
};
