"use client";

import { useMemo, useState } from "react";

import { clePost, type PostCampagne } from "@/lib/x-campagnes/types";

import { PostCarte } from "./PostCarte";
import { documentDepuisPost, Visionneuse } from "./Visionneuse";

/*
 * Îlot interactif de la galerie : il détient l'index ouvert et monte la
 * visionneuse. Il ne reçoit QUE des données sérialisables — la page serveur lit
 * Postgres, ce composant ne connaît ni `queries.ts` ni `pg`.
 *
 * Le préchargement des premières vignettes n'est PAS fait à la main : `priority`
 * sur les quatre premières cartes fait émettre à `next/image` un
 * `<link rel="preload">` portant l'URL réellement servie par l'optimiseur (une
 * balise écrite à la main pointerait sur l'original et téléchargerait deux fois).
 */

/** Nombre de cartes rendues en `priority` — la première rangée en 4 colonnes. */
const CARTES_PRIORITAIRES = 4;

export function CampagneGalerie({ posts }: { posts: PostCampagne[] }) {
	const [indexOuvert, setIndexOuvert] = useState<number | null>(null);
	// La visionneuse est générique (elle montre aussi l'affiche et la carte des
	// règles) : c'est ici qu'une publication devient un document visionnable.
	const documents = useMemo(() => posts.map(documentDepuisPost), [posts]);

	if (posts.length === 0) {
		return null;
	}

	return (
		<>
			{/* 320 px → 1 colonne, 375 px → 2, 1024 px → 3, 1280 px → 4. */}
			<ul className="grid list-none grid-cols-1 gap-4 p-0 xs:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
				{posts.map((post, position) => (
					<li key={clePost(post)} className="flex">
						<PostCarte
							post={post}
							priorite={position < CARTES_PRIORITAIRES}
							onOuvrir={() => setIndexOuvert(position)}
						/>
					</li>
				))}
			</ul>

			<Visionneuse
				documents={documents}
				index={indexOuvert}
				onFermer={() => setIndexOuvert(null)}
				onNaviguer={setIndexOuvert}
			/>
		</>
	);
}
