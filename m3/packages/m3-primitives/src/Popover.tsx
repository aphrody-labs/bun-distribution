// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/Popover.tsx), MIT, rebuilt on Material Design 3.
"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { clsx } from "clsx";
import {
  cloneElement,
  createContext,
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react";

import { type AsChildProp, asChildProps, createPortalScope, withClassName } from "./base-ui";

/** Convenience hook for controlled popover state */
export function usePopover() {
  const [open, setOpen] = useState(false);
  return { open, setOpen };
}

/** Element registered by {@link Anchor}; the positioner anchors to it instead of the trigger. */
const AnchorContext = createContext<{
  anchor: Element | null;
  setAnchor: (element: Element | null) => void;
} | null>(null);

export type PopoverRootProps = PopoverPrimitive.Root.Props;

const Root = (props: PopoverRootProps) => {
  const [anchor, setAnchor] = useState<Element | null>(null);
  const value = useMemo(() => ({ anchor, setAnchor }), [anchor]);
  return (
    <AnchorContext.Provider value={value}>
      <PopoverPrimitive.Root {...props} />
    </AnchorContext.Provider>
  );
};
Root.displayName = "PopoverRoot";

export interface PopoverTriggerProps extends PopoverPrimitive.Trigger.Props, AsChildProp {}

const Trigger = forwardRef<HTMLButtonElement, PopoverTriggerProps>(
  ({ asChild, children, ...props }, ref) => {
    const child = asChildProps(asChild, children);
    return <PopoverPrimitive.Trigger ref={ref} {...child} {...props} />;
  },
);
Trigger.displayName = "PopoverTrigger";

export interface PopoverCloseProps extends PopoverPrimitive.Close.Props, AsChildProp {}

const Close = forwardRef<HTMLButtonElement, PopoverCloseProps>(
  ({ asChild, children, ...props }, ref) => {
    const child = asChildProps(asChild, children);
    return <PopoverPrimitive.Close ref={ref} {...child} {...props} />;
  },
);
Close.displayName = "PopoverClose";

/**
 * Radix `Popover.Anchor`: positions the popover against this element instead of the trigger
 * (Base UI takes the element through the positioner's `anchor` prop).
 */
const Anchor = ({
  asChild,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & AsChildProp & { children?: ReactNode }) => {
  const ctx = useContext(AnchorContext);
  const child = asChildProps(asChild, children);
  if (child.render) {
    return cloneElement(child.render, { ...props, ref: ctx?.setAnchor } as HTMLAttributes<Element>);
  }
  return (
    <div ref={ctx?.setAnchor} {...props}>
      {children}
    </div>
  );
};
Anchor.displayName = "PopoverAnchor";

const { Portal, EnsurePortal } = createPortalScope(PopoverPrimitive.Portal, "PopoverPortal");

/**
 * M3 rich-tooltip / menu-like surface: `surface-container`, medium corners, level 2. Enters with
 * the emphasized-decelerate easing from the trigger side and leaves with emphasized-accelerate
 * (Base UI keeps the popup mounted through `data-ending-style`).
 */
export const popoverSurfaceClassNames = clsx(
  "flex flex-col",
  "cursor-default select-none rounded-medium",
  "text-left text-body-medium text-on-surface",
  "bg-surface-container",
  "shadow-md3-2",
  "origin-(--transform-origin) outline-none",
  "transition-[opacity,scale] duration-250 ease-emphasized-decelerate",
  "data-starting-style:scale-95 data-starting-style:opacity-0",
  "data-ending-style:scale-95 data-ending-style:opacity-0 data-ending-style:duration-150 data-ending-style:ease-emphasized-accelerate",
);

type PositionerProps = Pick<
  PopoverPrimitive.Positioner.Props,
  | "side"
  | "sideOffset"
  | "align"
  | "alignOffset"
  | "collisionPadding"
  | "collisionBoundary"
  | "collisionAvoidance"
  | "sticky"
  | "anchor"
  | "positionMethod"
  | "arrowPadding"
>;

export interface PopoverContentProps extends PositionerProps, PopoverPrimitive.Popup.Props {
  /** Radix name for the portal's `keepMounted`. */
  forceMount?: boolean;
}

const Content = forwardRef<HTMLDivElement, PopoverContentProps>(
  (
    {
      className,
      side,
      sideOffset = 8,
      align,
      alignOffset,
      collisionPadding,
      collisionBoundary,
      collisionAvoidance,
      sticky,
      anchor,
      positionMethod,
      arrowPadding,
      forceMount,
      initialFocus = false,
      finalFocus = false,
      ...props
    },
    ref,
  ) => {
    const ctx = useContext(AnchorContext);
    return (
      <EnsurePortal keepMounted={forceMount}>
        <PopoverPrimitive.Positioner
          className="z-[9999]"
          side={side}
          sideOffset={sideOffset}
          align={align}
          alignOffset={alignOffset}
          collisionPadding={collisionPadding}
          collisionBoundary={collisionBoundary}
          collisionAvoidance={collisionAvoidance}
          sticky={sticky}
          anchor={anchor ?? ctx?.anchor ?? undefined}
          positionMethod={positionMethod}
          arrowPadding={arrowPadding}
        >
          <PopoverPrimitive.Popup
            ref={ref}
            initialFocus={initialFocus}
            finalFocus={finalFocus}
            className={withClassName(popoverSurfaceClassNames, className)}
            {...props}
          />
        </PopoverPrimitive.Positioner>
      </EnsurePortal>
    );
  },
);

Content.displayName = "PopoverContent";

export const Popover = {
  Root,
  Trigger,
  Content,
  Anchor,
  Close,
  Portal,
};

// Named exports for direct imports
export {
  Root as PopoverRoot,
  Trigger as PopoverTrigger,
  Content as PopoverContent,
  Anchor as PopoverAnchor,
  Close as PopoverClose,
  Portal as PopoverPortal,
};
