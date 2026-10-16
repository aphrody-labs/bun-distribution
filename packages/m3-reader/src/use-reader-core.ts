// SPDX-License-Identifier: Apache-2.0
"use client";

/**
 * Behaviour shared by `MangaReader` and `CaptionedReader`: reading mode, fullscreen, the Swiper
 * handle and the scroll-position sync of the virtualized vertical mode.
 */

import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Virtualizer } from "@tanstack/react-virtual";
import type { SwiperClass } from "swiper/react";

export type ViewMode = "paged" | "vertical";

/**
 * Above this many pages the thumbnail strip (one DOM node per page, up to ~282 for a whole volume)
 * is too heavy: a compact "go to page" control replaces it.
 */
export const SHOW_STRIP_MAX = 40;

/**
 * Fullscreen state of this container. The toggle resolves false on native failure;
 * `fullscreenError` exposes that failure without rejecting a button's event handler.
 */
export function useFullscreen(containerRef: RefObject<HTMLElement | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<Error | null>(null);
  const mounted = useRef(false);
  const operation = useRef(0);

  const toggleFullscreen = useCallback(async (): Promise<boolean> => {
    const el = containerRef.current;
    if (!el) return false;
    const doc = el.ownerDocument;
    const current = ++operation.current;
    if (mounted.current) setFullscreenError(null);
    try {
      if (doc.fullscreenElement === el) {
        if (typeof doc.exitFullscreen !== "function")
          throw new Error("Fullscreen exit is unavailable");
        await doc.exitFullscreen();
      } else {
        // Request this container directly; never exit another component's fullscreen.
        if (typeof el.requestFullscreen !== "function")
          throw new Error("Fullscreen is unavailable");
        await el.requestFullscreen();
      }
      if (mounted.current && current === operation.current) {
        setIsFullscreen(
          Boolean(
            containerRef.current &&
            doc.fullscreenElement === containerRef.current,
          ),
        );
      }
      return true;
    } catch (reason) {
      if (mounted.current && current === operation.current) {
        setFullscreenError(
          reason instanceof Error ? reason : new Error(String(reason)),
        );
      }
      return false;
    }
  }, [containerRef]);

  useEffect(() => {
    const doc = containerRef.current?.ownerDocument;
    if (!doc) return;
    mounted.current = true;
    const onChange = () =>
      setIsFullscreen(
        Boolean(
          containerRef.current &&
          doc.fullscreenElement === containerRef.current,
        ),
      );
    onChange();
    doc.addEventListener("fullscreenchange", onChange);
    return () => {
      mounted.current = false;
      // oxlint-disable-next-line react-hooks/exhaustive-deps -- operation est un compteur de génération (pas un nœud DOM) : l'incrément en cleanup invalide les bascules en vol
      operation.current++;
      doc.removeEventListener("fullscreenchange", onChange);
    };
  }, [containerRef]);

  return { isFullscreen, fullscreenError, toggleFullscreen };
}

/** The Swiper instance and the two callbacks that keep `current` in step with it. */
export function useSwiperSync(setCurrent: (index: number) => void) {
  const swiperRef = useRef<SwiperClass | null>(null);

  const handleSwiper = useCallback(
    (sw: SwiperClass) => {
      swiperRef.current = sw;
      setCurrent(sw.realIndex ?? sw.activeIndex ?? 0);
    },
    [setCurrent],
  );

  const handleSlideChange = useCallback(
    (sw: SwiperClass) => setCurrent(sw.realIndex ?? sw.activeIndex ?? 0),
    [setCurrent],
  );

  return { swiperRef, handleSwiper, handleSlideChange };
}

/** In vertical mode, `current` follows the page at the middle of the scroll viewport. */
export function useVerticalScrollSync(
  mode: ViewMode,
  scrollParentRef: RefObject<HTMLElement | null>,
  virtualizer: Virtualizer<HTMLDivElement, Element>,
  setCurrent: (index: number) => void,
  restoring?: RefObject<boolean>,
) {
  useEffect(() => {
    if (mode !== "vertical") return;
    const el = scrollParentRef.current;
    if (!el) return;
    const onScroll = () => {
      if (restoring?.current) return;
      const mid = el.scrollTop + el.clientHeight / 2;
      const item = virtualizer
        .getVirtualItems()
        .find((vi) => vi.start <= mid && vi.end >= mid);
      if (item) setCurrent(item.index);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [mode, scrollParentRef, virtualizer, setCurrent, restoring]);
}

/** Absolute placement of one virtual row. */
export const virtualRowStyle = (start: number): CSSProperties => ({
  position: "absolute",
  top: 0,
  left: 0,
  width: "100%",
  transform: `translateY(${start}px)`,
});
