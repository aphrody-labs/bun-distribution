// SPDX-License-Identifier: Apache-2.0
"use client";
import { useLayoutEffect, useRef, type RefObject } from "react";
import type { Virtualizer } from "@tanstack/react-virtual";
import type { ViewMode } from "./use-reader-core";

/** Keep the selected scan anchored while the newly mounted vertical rows are measured. */
export function useModePageRestoration(
  mode: ViewMode,
  current: number,
  scrollRef: RefObject<HTMLDivElement | null>,
  virtualizer: Virtualizer<HTMLDivElement, Element>,
  containerRef: RefObject<HTMLDivElement | null>,
) {
  const previousMode = useRef(mode);
  const restoring = useRef(false);
  const restore = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const enteringVertical =
      previousMode.current === "paged" && mode === "vertical";
    previousMode.current = mode;
    if (!enteringVertical) return;
    const scroll = scrollRef.current;
    if (!scroll) return;
    const container = containerRef.current ?? scroll;
    restoring.current = true;
    const anchor = () => {
      if (restoring.current)
        virtualizer.scrollToIndex(current, { align: "start" });
    };
    restore.current = anchor;
    const release = () => {
      restoring.current = false;
      restore.current = null;
    };
    const onKey = (event: KeyboardEvent) => {
      if (
        [
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "PageUp",
          "PageDown",
          "Home",
          "End",
          " ",
        ].includes(event.key)
      )
        release();
    };
    for (const name of ["wheel", "touchstart", "pointerdown"] as const)
      container.addEventListener(name, release, {
        capture: true,
        passive: true,
      });
    container.addEventListener("keydown", onKey, true);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(anchor);
    observer?.observe(scroll);
    if (scroll.firstElementChild) observer?.observe(scroll.firstElementChild);
    anchor();
    return () => {
      release();
      observer?.disconnect();
      for (const name of ["wheel", "touchstart", "pointerdown"] as const)
        container.removeEventListener(name, release, true);
      container.removeEventListener("keydown", onKey, true);
    };
  }, [mode, current, scrollRef, virtualizer, containerRef]);

  // TanStack renders again as each image replaces its estimated row height.
  useLayoutEffect(() => {
    restore.current?.();
  });
  return restoring;
}
