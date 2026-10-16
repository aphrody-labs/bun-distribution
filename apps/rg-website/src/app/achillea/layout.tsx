import type { Metadata } from "next";
import "./achillea.css";
import "./primeicons.css";

import { absoluteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
	title: {
		default: "Achilléa — E-Sport & Compétition Inazuma Eleven | Rose Griffon",
		template: "%s | Achilléa — Rose Griffon",
	},
	description:
		"La scène compétitive officielle Inazuma Eleven: Victory Road. Clans, classements classés ELO (1v1, 2v2), Astral League, tournois communautaires et bot Discord officiel.",
	icons: {
		icon: "/achillea/achillea_ico.png",
		shortcut: "/achillea/achillea_ico.png",
		apple: "/achillea/achillea_ico.png",
	},
	/*
	 * PAS de `alternates.canonical` ici.
	 *
	 * `alternates` est hérité par tous les segments enfants : le canonical
	 * `/achillea` qui vivait dans ce layout déclarait les 40 pages du domaine
	 * comme de simples variantes de l'accueil, et demandait donc leur
	 * désindexation. Chaque page porte désormais le sien via
	 * `metadonneesAchillea()` (`./metadonnees.ts`).
	 */
	openGraph: {
		title: "Achilléa — E-Sport & Compétition Inazuma Eleven",
		description:
			"La scène compétitive officielle Inazuma Eleven: Victory Road. Tournois, clans, ranked et championnats.",
		url: absoluteUrl("/achillea"),
		siteName: "Achilléa Rose Griffon",
		locale: "fr_FR",
		type: "website",
		images: [
			{
				url: "/achillea/achillea-banner.png",
				width: 1200,
				height: 630,
				alt: "Bannière Achilléa",
			},
		],
	},
	twitter: {
		card: "summary_large_image",
		title: "Achilléa — E-Sport Inazuma Eleven",
		description:
			"La scène compétitive Inazuma Eleven: Victory Road. Tournois, clans, ranked et championnats.",
		images: ["/achillea/achillea-banner.png"],
	},
};

export default function AchilleaLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<div className="achillea-scope min-h-full w-full min-w-0">
			{/*
			 * PLUS DE SECONDE BARRE.
			 *
			 * `AchilleaNav` rendait ici une barre d'onglets de neuf entrées, sous
			 * la barre supérieure du site et à côté d'une barre latérale qui
			 * portait DÉJÀ les mêmes destinations. Trois surfaces de navigation
			 * empilées sur un même écran, dont deux disaient la même chose, plus
			 * un second bouton « Connexion » pour un compte désormais unique.
			 *
			 * Le menu latéral ouvre son groupe « E-sport » dès qu'on est sous
			 * `/achillea/**` : la navigation du domaine est là, une seule fois.
			 */}
			<div className="achillea-shell">{children}</div>
		</div>
	);
}
