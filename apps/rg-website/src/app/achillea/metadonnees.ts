import type { Metadata } from "next";

import { SITE_URL } from "@/lib/site-url";

/**
 * Fabrique des métadonnées des pages Achilléa.
 *
 * POURQUOI CE FICHIER EXISTE
 * Le layout Achilléa déclarait `alternates.canonical =
 * "https://rosegriffon.fr/achillea"`. En Next, `alternates` est hérité par tous
 * les segments enfants : les 40 pages du domaine annonçaient donc à Google
 * qu'elles n'étaient que des variantes de la page d'accueil. Un canonical qui
 * ment ne fait pas que rater une indexation — il demande explicitement de ne
 * PAS indexer la page qui le porte. Le classement ELO, les 42 clans, les 9
 * tournois et la ligue Astral étaient invisibles par construction.
 *
 * Deuxième cause, plus banale : 29 `page.tsx` commençaient par `"use client"`,
 * ce qui interdit `export const metadata`. Toutes ces pages retombaient sur le
 * `title.default` du layout et partageaient un unique titre. D'où la scission
 * systématique `page.tsx` (serveur, porte les métadonnées) + `*-client.tsx`
 * (l'interface interactive, inchangée).
 *
 * Ce module centralise la forme des métadonnées pour que l'origine, la bannière
 * et la politique d'indexation ne soient pas recopiées 40 fois — c'est
 * exactement ce genre de recopie qui a produit le canonical unique.
 */

/** Origine publique du site. `alternates.canonical` doit être absolu. */
const ORIGINE = SITE_URL;

/** Bannière Open Graph par défaut du domaine compétitif. */
const BANNIERE = "/achillea/achillea-banner.png";

export interface OptionsMetadonnees {
	/**
	 * Titre propre à la page, SANS suffixe : le `title.template` du layout
	 * ajoute déjà « | Achilléa — Rose Griffon ».
	 */
	titre: string;
	description: string;
	/**
	 * Chemin canonique de la page, à partir de la racine du site.
	 *
	 * Pour les alias historiques (`/achillea/leagues/asytral-s1`,
	 * `/achillea/events/...`), on vise volontairement le chemin CIBLE : c'est
	 * l'usage légitime du canonical, celui qui regroupe les doublons au lieu de
	 * les effacer.
	 *
	 * `null` pour les URL qui contiennent un secret (QR de licence, code de
	 * défi) : leur canonical serait une fuite.
	 */
	chemin: string | null;
	/**
	 * `false` pour ce qui exige une session ou une permission : ces pages ne
	 * rendent rien d'utile à un robot, et leur version publique serait vide.
	 */
	indexable?: boolean;
}

/**
 * Réduit un texte libre (biographie de clan, règlement de tournoi) à une
 * description exploitable.
 *
 * Ces champs contiennent des sauts de ligne et font parfois plusieurs milliers
 * de caractères : recopiés tels quels, ils produisent une méta-description
 * tronquée au hasard par le moteur de recherche.
 */
export function resume(texte: string | null | undefined, maximum = 155): string | null {
	const propre = (texte ?? "").replace(/\s+/g, " ").trim();
	if (propre.length === 0) return null;
	return propre.length <= maximum ? propre : `${propre.slice(0, maximum - 1).trimEnd()}…`;
}

export function metadonneesAchillea({
	titre,
	description,
	chemin,
	indexable = true,
}: OptionsMetadonnees): Metadata {
	const url = chemin === null ? undefined : `${ORIGINE}${chemin}`;

	return {
		title: titre,
		description,
		...(url === undefined ? {} : { alternates: { canonical: url } }),
		robots: indexable
			? undefined
			: // `follow` reste vrai : ces pages mènent aux pages publiques, et
				// couper le suivi isolerait le reste du domaine.
				{ index: false, follow: true },
		openGraph: {
			title: titre,
			description,
			...(url === undefined ? {} : { url }),
			siteName: "Achilléa Rose Griffon",
			locale: "fr_FR",
			type: "website",
			images: [{ url: BANNIERE, width: 1200, height: 630, alt: "Bannière Achilléa" }],
		},
		twitter: {
			card: "summary_large_image",
			title: titre,
			description,
			images: [BANNIERE],
		},
	};
}
