// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/Resizable.tsx), MIT, rebuilt on Material Design 3.
"use client";

import { clsx } from "clsx";
import {
  createContext,
  type HTMLAttributes,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import {
  type Resizable as ResizableType,
  useResizable,
  type UseResizableProps,
} from "react-resizable-layout";

type ResizableContextProps = ResizableType & {
  size: number;
  collapsed: boolean;
};

const ResizableContext = createContext<ResizableContextProps | null>(null);

const useResizableContext = () => {
  const context = useContext(ResizableContext);

  if (!context) throw new Error("ResizableContext.Provider not found!");

  return context;
};

interface ResizableProps extends Omit<PropsWithChildren<UseResizableProps>, "axis"> {
  axis?: UseResizableProps["axis"];
  collapsed?: boolean;
  onCollapseChange?: (val: boolean) => void;
}

const Resizable = ({ axis = "x", ...props }: ResizableProps) => {
  const resizable = useResizable({ axis, ...props });
  const { min, collapsed, onCollapseChange } = props;

  const minSizeClientX = useRef<number | null>(null);

  useEffect(() => {
    if (!onCollapseChange || !resizable.isDragging || !min) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (minSizeClientX.current === null) {
        if (min === resizable.position && !collapsed) {
          minSizeClientX.current = e.clientX;
        }
        return;
      }

      const half = minSizeClientX.current / 2;

      if (e.clientX < half && !collapsed) onCollapseChange(true);
      else if (e.clientX > half && collapsed) onCollapseChange(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    return () => document.removeEventListener("mousemove", handleMouseMove);
  }, [min, collapsed, onCollapseChange, resizable.isDragging, resizable.position]);

  useEffect(() => {
    if (!resizable.isDragging) {
      minSizeClientX.current = null;
      document.body.style.cursor = "";
    } else {
      const cursor = axis === "x" ? "col-resize" : "row-resize";
      document.body.style.setProperty("cursor", cursor, "important");
    }
  }, [resizable.isDragging, axis]);

  const value = useMemo(
    () => ({
      ...resizable,
      size: collapsed ? 0 : resizable.position,
      collapsed: !!collapsed,
    }),
    [resizable, collapsed],
  );

  return <ResizableContext.Provider value={value}>{props.children}</ResizableContext.Provider>;
};

const ResizablePanel = (props: HTMLAttributes<HTMLDivElement>) => {
  const resizable = useResizableContext();
  return <div style={{ width: resizable.size }} {...props} />;
};

/**
 * Pane divider with an M3 drag handle: 1dp `outline-variant` line at rest, a `primary` handle
 * on hover, focus and drag, with the on-surface state layer (hover 8 %, focus 10 %, dragged
 * 16 %). The orientation follows the separator's `aria-orientation`.
 */
const ResizableHandle = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => {
  const resizable = useResizableContext();

  return (
    <div
      className={clsx(
        "group relative shrink-0 touch-none select-none outline-none",
        "transition-colors duration-200 ease-standard",
        // Hit area and cursor per orientation.
        "w-2 aria-[orientation=horizontal]:h-2 aria-[orientation=horizontal]:w-auto",
        "aria-[orientation=horizontal]:cursor-row-resize aria-[orientation=vertical]:cursor-col-resize",
        // Resting divider: 1dp outline-variant.
        "before:pointer-events-none before:absolute before:bg-outline-variant before:content-['']",
        "aria-[orientation=vertical]:before:inset-y-0 aria-[orientation=vertical]:before:left-1/2 aria-[orientation=vertical]:before:w-px aria-[orientation=vertical]:before:-translate-x-1/2",
        "aria-[orientation=horizontal]:before:inset-x-0 aria-[orientation=horizontal]:before:top-1/2 aria-[orientation=horizontal]:before:h-px aria-[orientation=horizontal]:before:-translate-y-1/2",
        // Active handle: primary, shown on hover / focus / drag.
        "after:pointer-events-none after:absolute after:rounded-full after:bg-primary after:opacity-0 after:content-['']",
        "after:transition-opacity after:duration-200 after:ease-standard",
        "aria-[orientation=vertical]:after:inset-y-0 aria-[orientation=vertical]:after:left-1/2 aria-[orientation=vertical]:after:w-1 aria-[orientation=vertical]:after:-translate-x-1/2",
        "aria-[orientation=horizontal]:after:inset-x-0 aria-[orientation=horizontal]:after:top-1/2 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:-translate-y-1/2",
        "hover:bg-on-surface/8 hover:after:opacity-100 focus-visible:bg-on-surface/10 focus-visible:after:opacity-100",
        resizable.isDragging && "bg-on-surface/16 after:opacity-100 hover:bg-on-surface/16",
        className,
      )}
      data-dragging={resizable.isDragging || undefined}
      {...props}
      {...resizable.separatorProps}
    />
  );
};

export { Resizable, ResizableHandle, ResizablePanel, useResizableContext };
