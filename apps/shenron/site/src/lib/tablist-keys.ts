/**
 * Navigation clavier des jeux d'onglets.
 *
 * Le site compte cinq `role="tablist"` écrits à la main (univers du wiki, tomes
 * du manga, tops communautaires, notes d'une fiche, best-of des sagas). Quatre
 * n'écoutaient aucune touche : au clavier, on tabulait onglet par onglet sans
 * jamais pouvoir parcourir la série comme le fait un lecteur d'écran, et
 * `Début`/`Fin` ne menaient nulle part.
 *
 * Conforme aux pratiques ARIA : ←/↑ et →/↓ déplacent d'un cran (en boucle),
 * `Début`/`Fin` vont aux extrémités, et l'onglet reçoit le focus *et*
 * l'activation (activation automatique — chaque panneau est déjà monté).
 *
 * Se combine avec un `tabIndex` tournant (`0` sur l'onglet actif, `-1` sur les
 * autres) pour que le jeu d'onglets ne représente qu'un seul arrêt de tabulation.
 */
import type { KeyboardEvent } from "react";

const TOUCHES = new Set(["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"]);

export function onTablistKeyDown(e: KeyboardEvent<HTMLElement>): void {
	if (!TOUCHES.has(e.key)) return;
	const onglets = Array.from(
		e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]:not([disabled])')
	);
	if (onglets.length < 2) return;

	const actif = typeof document === "undefined" ? null : (document.activeElement as HTMLElement);
	let i = actif ? onglets.indexOf(actif) : -1;
	// Focus hors du jeu d'onglets (activation à la souris) : on repart du sélectionné.
	if (i === -1)
		i = Math.max(
			0,
			onglets.findIndex((o) => o.getAttribute("aria-selected") === "true")
		);

	const cible =
		e.key === "Home"
			? 0
			: e.key === "End"
				? onglets.length - 1
				: e.key === "ArrowRight" || e.key === "ArrowDown"
					? (i + 1) % onglets.length
					: (i - 1 + onglets.length) % onglets.length;

	e.preventDefault();
	const suivant = onglets[cible];
	suivant?.focus();
	suivant?.click();
}
