// SPDX-License-Identifier: Apache-2.0

"use client";

import { CharacterGrid, type CharacterFacets, type GridCharacter } from "./CharacterGrid";
import { ENCYCLOPEDIA_CATEGORIES } from "@/lib/wiki-categories";
import { ClientGatedWrap } from "@/components/GatedClientLink";
import type { AccessSnapshot } from "@/lib/wiki-launch";

/**
 * Page Personnages : la grille + la barre des autres entrées encyclopédiques
 * (Cosmologie, Races, Transformations, Techniques, Arcs).
 *
 * Ce composant portait auparavant DEUX onglets, Personnages et Planètes, la
 * seconde grille étant rendue en ligne ici — si bien que la rubrique cosmologie
 * n'existait qu'en paramètre d'URL (`?tab=planetes`), sans page à elle, et que
 * `/wiki/planetes` n'était qu'un `redirect()` de composant vers cet onglet.
 * Elle a désormais son propre index (`/wiki/cosmologie`), comme les races ou
 * les arcs : il ne reste ici qu'une grille et des liens, donc plus de `tablist`
 * — un jeu d'onglets à un seul onglet n'en est pas un, et son `role="tab"`
 * promettait une navigation aux flèches qui ne menait nulle part.
 *
 * On n'y met jamais les catégories « media » (Sagas/Films/Épisodes/Manga/Jeux) :
 * elles sont déjà dans la navbar.
 */
const AUTRES_CATEGORIES = ENCYCLOPEDIA_CATEGORIES.filter((c) => c.key !== "personnages");

type Props = {
	characters: GridCharacter[];
	/** Nombre de versions par saga (les données sont chargées à la demande). */
	nbVariants?: number;
	counts?: Record<string, number>;
	facets?: CharacterFacets;
};

export function UniverseTabs({
	characters,
	nbVariants = 0,
	counts = {},
	facets,
	access,
}: Props & { access?: AccessSnapshot | null }) {
	return (
		<div className="space-y-8">
			<nav
				aria-label="Entrées de l'encyclopédie"
				// `min-w-0` : sans lui, l'enfant `shrink-0` (707 px de contenu) imposait sa
				// largeur au conteneur malgré `overflow-x-auto`, et c'est toute la page
				// qui s'étirait à 948 px dans un viewport de 390.
				className="flex min-w-0 items-center overflow-x-auto border-b border-white/[0.08] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
			>
				<span className="shrink-0 whitespace-nowrap border-b-2 border-dbz-orange px-5 py-3 font-display text-sm font-semibold text-dbz-orange">
					Personnages ({characters.length})
				</span>
				<span className="mx-2 h-5 w-px shrink-0 bg-white/10" aria-hidden />
				<div className="flex shrink-0 items-center">
					{AUTRES_CATEGORIES.map((c) => {
						const n = counts[c.countKey];
						return (
							<ClientGatedWrap
								access={access}
								key={c.key}
								href={c.href}
								className="whitespace-nowrap px-4 py-3 font-display text-sm font-semibold text-white/55 transition-colors hover:text-white"
							>
								{c.label}
								{typeof n === "number" && n > 0 && (
									<span className="ml-1 text-[11px] tabular-nums text-white/50">{n}</span>
								)}
							</ClientGatedWrap>
						);
					})}
				</div>
			</nav>

			<CharacterGrid
				characters={characters}
				nbVariants={nbVariants}
				facets={facets}
				access={access}
			/>
		</div>
	);
}
