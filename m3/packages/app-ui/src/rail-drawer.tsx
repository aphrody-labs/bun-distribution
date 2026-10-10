// SPDX-License-Identifier: Apache-2.0
// One navigation rail: a push rail on wide windows and a modal drawer on compact ones.
import { useEffect, useRef, useState, type ReactNode } from "react";

export const NARROW_QUERY = "(max-width: 839px)";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false,
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

export function Rail({
  expanded,
  label,
  children,
}: {
  expanded: boolean;
  label: string;
  children: ReactNode;
}) {
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

/** Native tab stops only; invisible, inert and disabled controls cannot receive modal focus. */
function focusTargets(scope: HTMLElement): HTMLElement[] {
  return [
    ...scope.querySelectorAll<HTMLElement>(
      'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]',
    ),
  ].filter((element) => {
    if (
      element.tabIndex < 0 ||
      element.matches(":disabled") ||
      element.getAttribute("aria-disabled") === "true" ||
      element.closest('[hidden], [inert], [aria-hidden="true"]')
    )
      return false;
    let ancestor: HTMLElement | null = element;
    while (ancestor) {
      const style = getComputedStyle(ancestor);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse"
      )
        return false;
      if (ancestor === scope) break;
      ancestor = ancestor.parentElement;
    }
    return true;
  });
}

/** Swipe, the visible close action, scrim and Escape all dismiss the same controlled drawer. */
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
    const panel = panelRef.current;
    if (!open || !pop || !panel) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Native top-layer support is optional: the fixed modal and hidden attribute also work
    // in a WebView without the popover API.
    if (typeof pop.showPopover === "function") pop.showPopover();
    scrollerRef.current?.scrollTo({ left: 0, behavior: "instant" });
    (focusTargets(panel)[0] ?? panel).focus();
    return () => {
      if (typeof pop.hidePopover === "function" && pop.matches(":popover-open")) pop.hidePopover();
      if (previous?.isConnected && !previous.closest("[inert], [hidden]")) previous.focus();
    };
  }, [open]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const panel = panelRef.current;
    if (!open || !scroller || !panel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry && !entry.isIntersecting) onOpenChange(false);
      },
      { root: scroller, threshold: 0 },
    );
    observer.observe(panel);
    return () => observer.disconnect();
  }, [open, onOpenChange]);

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- tiroir géré par l'API popover : un div stylé .app-drawer doit garder ses écouteurs clavier et souris
    <div
      ref={popoverRef}
      id="app-rail"
      popover="manual"
      hidden={!open}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- tiroir géré par l'API popover : un div stylé .app-drawer doit garder son rôle dialog explicite
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="app-drawer"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(false);
        } else if (event.key === "Tab" && panelRef.current) {
          const targets = focusTargets(panelRef.current);
          const first = targets[0] ?? panelRef.current;
          const last = targets.at(-1) ?? first;
          const active = document.activeElement;
          if (event.shiftKey && (active === first || !targets.includes(active as HTMLElement))) {
            event.preventDefault();
            last.focus();
          } else if (
            !event.shiftKey &&
            (active === last || !targets.includes(active as HTMLElement))
          ) {
            event.preventDefault();
            first.focus();
          }
        }
      }}
    >
      <div ref={scrollerRef} className="app-drawer-scroller">
        <aside ref={panelRef} className="app-drawer-panel" tabIndex={-1}>
          <div className="app-drawer-header">
            <span className="app-drawer-title">{label}</span>
            <button
              type="button"
              className="app-drawer-close"
              aria-label="Fermer le panneau"
              onClick={() => onOpenChange(false)}
            >
              <span className="material-symbol" aria-hidden="true">
                close
              </span>
            </button>
          </div>
          <div className="app-drawer-content">{children}</div>
        </aside>
        <button
          type="button"
          className="app-drawer-dismiss"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => onOpenChange(false)}
        />
      </div>
    </div>
  );
}
