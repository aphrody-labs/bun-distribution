"use client";

import { usePathname } from "next/navigation";
import { ViewTransition } from "@/components/ViewTransition";

/**
 * Point d'entrée unique des transitions de route.
 *
 * Les layouts persistent dans l'App Router : les y envelopper ne déclenche
 * jamais d'animation d'entrée ou de sortie. Cette couche vit dans le layout,
 * mais sa clé suit la route, afin que React voie bien l'ancien contenu quitter
 * puis le nouveau arriver lors d'une navigation annotée par `transitionTypes`.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
	const pathname = usePathname();

	return (
		<ViewTransition
			key={pathname}
			enter={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "none" }}
			exit={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "none" }}
			default="none"
		>
			{children}
		</ViewTransition>
	);
}
