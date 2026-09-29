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

export function useFocusTrap(
	panelRef: RefObject<HTMLElement | null>,
	active: boolean,
	onEscape?: () => void
): void {
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
	onEscapeRef.current = onEscape;

	useEffect(() => {
		if (!active) return;
		const prevFocused = document.activeElement as HTMLElement | null;
		// Le panneau doit porter `tabIndex={-1}` pour pouvoir recevoir le focus.
		panelRef.current?.focus();

		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onEscapeRef.current?.();
				return;
			}
			if (e.key !== "Tab") return;
			const panel = panelRef.current;
			if (!panel) return;
			const items = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
			if (items.length === 0) {
				e.preventDefault();
				panel.focus();
				return;
			}
			const first = items[0]!;
			const last = items[items.length - 1]!;
			const current = document.activeElement as HTMLElement | null;
			if (!current || !panel.contains(current)) {
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

		document.addEventListener("keydown", onKey);
		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";

		return () => {
			document.removeEventListener("keydown", onKey);
			document.body.style.overflow = prevOverflow;
			// Rend le focus au déclencheur : sans ça, fermer la modale laisse
			// l'utilisateur au clavier en haut du document.
			prevFocused?.focus?.();
		};
	}, [panelRef, active]);
}
