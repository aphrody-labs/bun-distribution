// SPDX-License-Identifier: Apache-2.0
"use client";

/**
 * Piège de focus pour une boîte de dialogue modale (WCAG 2.4.3 / 2.1.2).
 *
 * Keeps Tab inside the panel, closes on Escape, and restores focus on exit.
 * A click on non-focusable text moves focus back into the panel on the next Tab.
 */
import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

interface FocusLease {
  panel: HTMLElement;
  previousFocused: HTMLElement | null;
  previousTrap?: FocusLease;
}

// The document scroll lock is shared; only the last activated modal handles keys.
const activeTraps = new WeakMap<Document, { stack: FocusLease[]; previousOverflow: string }>();

/** Native tab stops, excluding controls hidden or disabled through their ancestors. */
function isTabbable(element: HTMLElement): boolean {
  if (element.tabIndex < 0 || element.matches(":disabled, input[type='hidden']")) return false;
  if (element.closest("[hidden], [inert]")) return false;
  const view = element.ownerDocument.defaultView;
  const visibility = view?.getComputedStyle(element).visibility;
  if (visibility === "hidden" || visibility === "collapse") return false;
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    if (view?.getComputedStyle(ancestor).display === "none") return false;
  }
  return true;
}

export function useFocusTrap(panelRef: RefObject<HTMLElement | null>, active: boolean, onEscape?: () => void): void {
  // `onEscape` est presque toujours une lambda écrite dans le JSX de l'appelant
  // (`() => setLightbox(false)`), donc une NOUVELLE fonction à chaque rendu. En
  // dépendance d'effet, elle rejouait tout le montage du piège à chaque rendu
  // de la modale : le nettoyage rendait le focus au déclencheur, l'effet
  // suivant le reprenait sur le panneau — l'utilisateur au clavier était donc
  // ramené en tête du panneau dès qu'un état changeait, et `prevFocused`
  // mémorisait le panneau au lieu du bouton d'ouverture, si bien que fermer ne
  // rendait plus le focus au bon endroit. On garde la fonction dans une ref :
  // l'effet ne dépend plus que de ce qui doit réellement le rejouer.
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    if (!active) return;
    const panel = panelRef.current;
    if (!panel) return;
    const doc = panel.ownerDocument;
    let state = activeTraps.get(doc);
    if (!state) {
      state = { stack: [], previousOverflow: doc.body.style.overflow };
      activeTraps.set(doc, state);
    }
    const lease: FocusLease = {
      panel,
      previousFocused: doc.activeElement as HTMLElement | null,
      previousTrap: state.stack.at(-1),
    };
    state.stack.push(lease);
    // Le panneau doit porter `tabIndex={-1}` pour pouvoir recevoir le focus.
    panelRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (state.stack.at(-1) !== lease) return;
      if (e.key === "Escape") {
        onEscapeRef.current?.();
        return;
      }
      if (e.key !== "Tab") return;
      const currentPanel = panelRef.current;
      if (!currentPanel) return;
      const items = [...currentPanel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(isTabbable);
      if (items.length === 0) {
        e.preventDefault();
        currentPanel.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const current = doc.activeElement as HTMLElement | null;
      if (!current || !items.includes(current)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && current === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    };

    doc.addEventListener("keydown", onKey);
    doc.body.style.overflow = "hidden";

    return () => {
      doc.removeEventListener("keydown", onKey);
      const wasTop = state.stack.at(-1) === lease;
      state.stack.splice(state.stack.indexOf(lease), 1);
      // Preserve the opener chain even when a lower modal is removed first.
      for (const remaining of state.stack) {
        if (remaining.previousTrap === lease) {
          remaining.previousTrap = lease.previousTrap;
          remaining.previousFocused = lease.previousFocused;
        }
      }
      const top = state.stack.at(-1);
      if (!top) {
        doc.body.style.overflow = state.previousOverflow;
        activeTraps.delete(doc);
      }
      if (wasTop) {
        const previous = lease.previousFocused;
        if (previous?.isConnected && (!top || top.panel.contains(previous))) previous.focus();
        else top?.panel.focus();
      }
    };
  }, [panelRef, active]);
}
