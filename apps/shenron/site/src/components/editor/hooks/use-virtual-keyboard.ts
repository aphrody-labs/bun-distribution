"use client";

/**
 * Hauteur occupée par le clavier virtuel, en pixels.
 *
 * Sur mobile, un `position: fixed; bottom: 0` reste **sous** le clavier : la
 * barre d'outils devient inatteignable au moment précis où on écrit. On suit donc
 * `visualViewport` — la seule mesure qui reflète la zone réellement visible — et
 * on décale la barre d'autant.
 *
 * Retourne 0 sur un poste fixe (aucun clavier virtuel, aucun décalage).
 */
import { useEffect, useState } from "react";

export function useVirtualKeyboard(): number {
	const [offset, setOffset] = useState(0);

	useEffect(() => {
		const vv = window.visualViewport;
		if (!vv) return;
		const update = () => {
			// Hauteur de la fenêtre - (hauteur visible + décalage haut) = clavier.
			const hidden = window.innerHeight - vv.height - vv.offsetTop;
			setOffset(hidden > 80 ? Math.round(hidden) : 0); // < 80 px = barre d'URL, pas un clavier
		};
		update();
		vv.addEventListener("resize", update);
		vv.addEventListener("scroll", update);
		return () => {
			vv.removeEventListener("resize", update);
			vv.removeEventListener("scroll", update);
		};
	}, []);

	return offset;
}
