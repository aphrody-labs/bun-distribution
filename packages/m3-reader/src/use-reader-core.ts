"use client";

/**
 * Behaviour shared by `MangaReader` and `DatabookReader`: reading mode, fullscreen, the Swiper
 * handle and the scroll-position sync of the virtualized vertical mode.
 */

import { type CSSProperties, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { Virtualizer } from "@tanstack/react-virtual";
import type { SwiperClass } from "swiper/react";

export type ViewMode = "paged" | "vertical";

/**
 * Above this many pages the thumbnail strip (one DOM node per page, up to ~282 for a whole volume)
 * is too heavy: a compact "go to page" control replaces it.
 */
export const SHOW_STRIP_MAX = 40;

/** Fullscreen state of `containerRef` and the toggle. */
export function useFullscreen(containerRef: RefObject<HTMLElement | null>) {
	const [isFullscreen, setIsFullscreen] = useState(false);

	const toggleFullscreen = useCallback(() => {
		const el = containerRef.current;
		if (!el) return;
		if (document.fullscreenElement) void document.exitFullscreen();
		else void el.requestFullscreen?.();
	}, [containerRef]);

	useEffect(() => {
		const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
		document.addEventListener("fullscreenchange", onChange);
		return () => document.removeEventListener("fullscreenchange", onChange);
	}, []);

	return { isFullscreen, toggleFullscreen };
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
) {
	useEffect(() => {
		if (mode !== "vertical") return;
		const el = scrollParentRef.current;
		if (!el) return;
		const onScroll = () => {
			const mid = el.scrollTop + el.clientHeight / 2;
			const item = virtualizer.getVirtualItems().find((vi) => vi.start <= mid && vi.end >= mid);
			if (item) setCurrent(item.index);
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		onScroll();
		return () => el.removeEventListener("scroll", onScroll);
	}, [mode, scrollParentRef, virtualizer, setCurrent]);
}

/** Absolute placement of one virtual row. */
export const virtualRowStyle = (start: number): CSSProperties => ({
	position: "absolute",
	top: 0,
	left: 0,
	width: "100%",
	transform: `translateY(${start}px)`,
});
