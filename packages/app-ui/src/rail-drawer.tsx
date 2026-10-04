// SPDX-License-Identifier: Apache-2.0
// Navigation rail: a push rail on wide windows, a swipeable manual-popover drawer on narrow ones.
// Web platform only (popover, scroll-snap, IntersectionObserver, matchMedia); styles in app.css.

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Below this width the rail turns into a drawer (M3 compact and medium window classes). */
export const NARROW_QUERY = "(max-width: 839px)";

/** Tracks a media query; false outside a browser (SSR, tests). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Push rail: the slot snaps, the panel slides (spring easings in app.css). */
export function Rail({ expanded, label, children }: { expanded: boolean; label: string; children: ReactNode }) {
  return (
    <aside
      id="app-rail"
      className="app-rail z-[65]"
      data-expanded={expanded ? "true" : "false"}
      aria-label={label}
      inert={!expanded || undefined}
    >
      <div className="app-rail-panel">{children}</div>
    </aside>
  );
}

/**
 * Drawer for narrow windows. Swiping the panel away (scroll-snap to the dismiss
 * area), tapping the scrim or pressing Escape closes it.
 */
export function RailDrawer({
  open,
  onOpenChange,
  label,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  children: ReactNode;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const pop = popoverRef.current;
    if (!pop || typeof pop.showPopover !== "function") return;
    const shown = pop.matches(":popover-open");
    if (open && !shown) {
      pop.showPopover();
      scrollerRef.current?.scrollTo({ left: 0, behavior: "instant" });
      panelRef.current?.querySelector<HTMLElement>("a, button, [tabindex]")?.focus();
    } else if (!open && shown) {
      pop.hidePopover();
      document.querySelector<HTMLElement>('[aria-controls="app-rail"]')?.focus();
    }
  }, [open]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const panel = panelRef.current;
    if (!open || !scroller || !panel || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry && !entry.isIntersecting) onOpenChange(false);
      },
      { root: scroller, threshold: 0 },
    );
    io.observe(panel);
    return () => io.disconnect();
  }, [open, onOpenChange]);

  return (
    <div
      ref={popoverRef}
      id="app-rail"
      popover="manual"
      className="app-drawer"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onOpenChange(false);
        }
      }}
    >
      <div ref={scrollerRef} className="app-drawer-scroller">
        <aside ref={panelRef} className="app-drawer-panel" aria-label={label}>
          {children}
        </aside>
        <button
          type="button"
          className="app-drawer-dismiss"
          aria-label="Fermer le panneau"
          onClick={() => onOpenChange(false)}
        />
      </div>
    </div>
  );
}
