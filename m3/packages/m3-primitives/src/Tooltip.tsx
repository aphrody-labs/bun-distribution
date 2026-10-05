// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/Tooltip.tsx), MIT, rebuilt on Material Design 3.
"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { clsx } from "clsx";
import { forwardRef, isValidElement, type PropsWithChildren, type ReactNode } from "react";

import { type AsChildProp, asChildProps, createPortalScope, withClassName } from "./base-ui";

/** Keybind chip inside a plain tooltip (`inverse-surface`), in `inverse-on-surface` tones. */
export const Kbd = ({ children, className }: { children: ReactNode; className?: string }) => (
  <kbd
    className={clsx(
      "flex h-4.5 min-w-4.5 items-center justify-center rounded-extra-small px-1 font-plain text-label-small",
      "bg-inverse-on-surface/12 text-inverse-on-surface/80",
      className,
    )}
  >
    {children}
  </kbd>
);

/** M3 plain tooltip: `inverse-surface`, extra-small corners, body-small, 24dp minimum height. */
export const tooltipClassNames = clsx(
  "z-[101] flex min-h-6 max-w-[200px] select-text items-center gap-2 break-words",
  "rounded-extra-small bg-inverse-surface px-2 py-1 text-center text-body-small text-inverse-on-surface",
  "origin-(--transform-origin)",
  "transition-[opacity,scale] duration-150 ease-standard",
  "data-starting-style:scale-90 data-starting-style:opacity-0 data-ending-style:opacity-0",
  "data-instant:transition-none",
);

type Side = "top" | "right" | "bottom" | "left";
type Align = "start" | "center" | "end";

export interface TooltipProps extends PropsWithChildren {
  label: ReactNode;
  position?: Side;
  className?: string;
  tooltipClassName?: string;
  labelClassName?: string;
  asChild?: boolean;
  keybinds?: Array<string>;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Hover delay before opening, in ms (Radix name; Base UI `delay`). */
  delayDuration?: number;
  /** Base UI name for {@link TooltipProps.delayDuration}. */
  delay?: number;
  /** Close as soon as the pointer leaves the trigger (Radix name; Base UI `disableHoverablePopup`). */
  disableHoverableContent?: boolean;
  /** Keep the tooltip closed (Base UI). */
  disabled?: boolean;
  sideOffset?: number;
  alignOffset?: number;
  align?: Align;
}

const separateKeybinds = (keybinds: TooltipProps["keybinds"]): TooltipProps["keybinds"] => {
  if (!keybinds) return;
  const arr: NonNullable<TooltipProps["keybinds"]> = [];
  for (const i of keybinds) {
    if (i.length >= 2) {
      arr.push(i);
      continue;
    }
    for (const j of i) {
      arr.push(j);
    }
  }
  return arr;
};

const { Portal: TooltipPortal, EnsurePortal } = createPortalScope(
  TooltipPrimitive.Portal,
  "TooltipPortal",
);

/** Plain M3 tooltip on Base UI: opens on hover and keyboard focus, closes on Escape. */
export const Tooltip = ({ position = "bottom", sideOffset = 4, ...props }: TooltipProps) => {
  const trigger =
    props.asChild && isValidElement(props.children) ? (
      props.children
    ) : (
      <span className={props.className}>{props.children}</span>
    );
  return (
    <TooltipPrimitive.Root
      disableHoverablePopup={props.disableHoverableContent}
      open={props.open}
      defaultOpen={props.defaultOpen}
      onOpenChange={props.onOpenChange && ((open) => props.onOpenChange?.(open))}
      disabled={props.disabled}
    >
      <TooltipPrimitive.Trigger delay={props.delay ?? props.delayDuration} render={trigger} />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner
          side={position}
          align={props.align}
          sideOffset={sideOffset}
          alignOffset={props.alignOffset}
          className="z-[101]"
        >
          <TooltipPrimitive.Popup
            className={clsx(
              "TooltipContent",
              tooltipClassNames,
              props.tooltipClassName,
              !props.label && "hidden",
            )}
          >
            <div className={props.labelClassName}>{props.label}</div>
            {props.keybinds && (
              <div className="flex items-center justify-center gap-1">
                {separateKeybinds(props.keybinds)?.map((k) => (
                  <Kbd key={k.toString()}>
                    <p>{k}</p>
                  </Kbd>
                ))}
              </div>
            )}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
};

export interface TooltipProviderProps extends TooltipPrimitive.Provider.Props {
  /** Radix name for Base UI `delay`. */
  delayDuration?: number;
  /** Radix name for Base UI `timeout` (window in which the next tooltip opens instantly). */
  skipDelayDuration?: number;
}

/** Shares the open delay between tooltips, so moving across a toolbar opens them instantly. */
export const TooltipProvider = ({
  delayDuration,
  skipDelayDuration,
  delay,
  timeout,
  ...props
}: TooltipProviderProps) => (
  <TooltipPrimitive.Provider
    delay={delay ?? delayDuration}
    timeout={timeout ?? skipDelayDuration}
    {...props}
  />
);

export const TooltipRoot = TooltipPrimitive.Root;

export interface TooltipTriggerProps extends TooltipPrimitive.Trigger.Props, AsChildProp {}

export const TooltipTrigger = forwardRef<HTMLButtonElement, TooltipTriggerProps>(
  ({ asChild, children, ...props }, ref) => {
    // Tooltip triggers take no `nativeButton`: only the element is forwarded.
    const child = asChildProps(asChild, children);
    return (
      <TooltipPrimitive.Trigger ref={ref} render={child.render} {...props}>
        {child.children}
      </TooltipPrimitive.Trigger>
    );
  },
);
TooltipTrigger.displayName = "TooltipTrigger";

export { TooltipPortal };

type TooltipPositionerProps = Pick<
  TooltipPrimitive.Positioner.Props,
  | "side"
  | "sideOffset"
  | "align"
  | "alignOffset"
  | "collisionPadding"
  | "collisionAvoidance"
  | "sticky"
  | "anchor"
>;

export interface TooltipContentProps extends TooltipPositionerProps, TooltipPrimitive.Popup.Props {}

/** Composable tooltip surface: portal (unless inside `TooltipPortal`), positioner and popup. */
export const TooltipContent = forwardRef<HTMLDivElement, TooltipContentProps>(
  (
    {
      className,
      side,
      sideOffset = 4,
      align,
      alignOffset,
      collisionPadding,
      collisionAvoidance,
      sticky,
      anchor,
      ...props
    },
    ref,
  ) => (
    <EnsurePortal>
      <TooltipPrimitive.Positioner
        className="z-[101]"
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        collisionPadding={collisionPadding}
        collisionAvoidance={collisionAvoidance}
        sticky={sticky}
        anchor={anchor}
      >
        <TooltipPrimitive.Popup
          ref={ref}
          className={withClassName(clsx("overflow-hidden", tooltipClassNames), className)}
          {...props}
        />
      </TooltipPrimitive.Positioner>
    </EnsurePortal>
  ),
);

TooltipContent.displayName = "TooltipContent";
