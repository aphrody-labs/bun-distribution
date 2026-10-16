// SPDX-License-Identifier: Apache-2.0
// Glue between the M3 primitives and Base UI (@base-ui/react), the headless layer.
"use client";

import { clsx } from "clsx";
import {
  type ComponentType,
  createContext,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useContext,
} from "react";

/** A Base UI `className`: a string or a function of the component state. */
export type StateClassName<S> = string | ((state: S) => string | undefined);

/**
 * Prepends the M3 classes to a Base UI `className`, keeping the state-function form Base UI
 * accepts, so callers can style from the component state as well as from data attributes.
 */
export function withClassName<S>(
  base: string,
  className?: StateClassName<S>,
): StateClassName<S> {
  if (typeof className === "function")
    return (state: S) => clsx(base, className(state));
  return clsx(base, className);
}

/**
 * Radix-compatible `asChild`: the single child element becomes the rendered element through
 * Base UI's `render` prop, which merges the part's props and ref into it.
 */
export function asChildProps(
  asChild: boolean | undefined,
  children: ReactNode,
): { render?: ReactElement; children?: ReactNode; nativeButton?: boolean } {
  if (!asChild || !isValidElement(children)) return { children };
  const type = children.type;
  // A host element other than <button> is not a native button; a component is assumed to render
  // one (Dropdown.Button, SelectPill, CircleButton...), which is Base UI's default.
  const nativeButton = typeof type === "string" ? type === "button" : undefined;
  return { render: children as ReactElement, nativeButton };
}

/** Radix-style `asChild` prop added to Base UI trigger / close parts. */
export interface AsChildProp {
  /** Render the single child element instead of the default element (Radix compatibility). */
  asChild?: boolean;
}

/**
 * Base UI positioners live inside a portal. Composable `*Content` parts render their own portal
 * unless the caller already wrapped them in the matching exported `*Portal` (the Radix pattern).
 */
export function createPortalScope<
  P extends { children?: ReactNode; keepMounted?: boolean },
>(BasePortal: ComponentType<P>, displayName: string) {
  const InPortal = createContext(false);

  const Portal = ({ forceMount, ...props }: P & { forceMount?: boolean }) => (
    <InPortal.Provider value={true}>
      <BasePortal
        {...(props as P)}
        keepMounted={props.keepMounted ?? forceMount}
      />
    </InPortal.Provider>
  );
  Portal.displayName = displayName;

  /** Wraps `children` in the portal unless an enclosing `Portal` already did. */
  const EnsurePortal = ({
    children,
    keepMounted,
  }: {
    children: ReactNode;
    keepMounted?: boolean;
  }) => {
    const inPortal = useContext(InPortal);
    if (inPortal) return <>{children}</>;
    return <Portal {...({ keepMounted } as P)}>{children}</Portal>;
  };

  return { Portal, EnsurePortal };
}
