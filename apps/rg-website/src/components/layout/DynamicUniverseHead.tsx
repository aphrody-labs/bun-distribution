"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { domaineDeLaRoute, type Domaine } from "@rosegriffon/app-shell";

interface UniverseMetaConfig {
	favicon: string;
	faviconType: string;
	appleIcon: string;
	themeColor: string;
	siteName: string;
	rootTitle: string;
	defaultTitleSuffix: string;
	description: string;
}

const UNIVERSE_CONFIGS: Record<Domaine, UniverseMetaConfig> = {
	association: {
		favicon: "/favicon.ico",
		faviconType: "image/x-icon",
		appleIcon: "/apple-icon.png",
		themeColor: "#a14b3f",
		siteName: "Rose Griffon",
		rootTitle: "Rose Griffon | Association Inazuma Eleven France",
		defaultTitleSuffix: " | Rose Griffon",
		description:
			"Site officiel de l'association Rose Griffon, rassemblant la communauté Inazuma Eleven en France. Découvrez nos événements, projets et rejoignez-nous !",
	},
	wiki: {
		favicon: "/RG_Azalee-logo.webp",
		faviconType: "image/webp",
		appleIcon: "/RG_Azalee-logo.webp",
		themeColor: "#240112",
		siteName: "Azalée Wiki",
		rootTitle: "Azalée — Le Wiki Inazuma Eleven: Victory Road | Rose Griffon",
		defaultTitleSuffix: " | Wiki Azalée | Rose Griffon",
		description:
			"Base de données complète Inazuma Eleven: Victory Road. Personnages, techniques, objets, quêtes et wiki communautaire.",
	},
	esport: {
		favicon: "/achillea/achillea_ico.png",
		faviconType: "image/png",
		appleIcon: "/achillea/achillea_ico.png",
		themeColor: "#0d0814",
		siteName: "Achilléa Rose Griffon",
		rootTitle: "Achilléa — E-Sport & Compétition Inazuma Eleven | Rose Griffon",
		defaultTitleSuffix: " | Achilléa — Rose Griffon",
		description:
			"La scène compétitive officielle Inazuma Eleven: Victory Road. Clans, classements classés ELO (1v1, 2v2), Astral League, tournois communautaires et coupes officielles.",
	},
};

/**
 * Gestionnaire client dynamique des métadonnées navigateur :
 * - Switch dynamique de la favicon selon l'univers (RG, Azalée, Achilléa)
 * - Switch dynamique du theme-color navigateur mobile (barre Safari/Chrome)
 * - Switch dynamique du titre d'onglet sur les pages d'accueil et transitions SPA
 * - Switch dynamique de og:site_name et description
 */
export function DynamicUniverseHead() {
	const pathname = usePathname() || "/";
	const activeDomaine = domaineDeLaRoute(pathname);
	const prevDomaineRef = useRef<Domaine | null>(null);

	useEffect(() => {
		const config = UNIVERSE_CONFIGS[activeDomaine];

		// 1. Mise à jour dynamique de la favicon et de l'icône tactile
		const updateFavicon = () => {
			const iconSelectors = [
				'link[rel="icon"]',
				'link[rel="shortcut icon"]',
				'link[rel="alternate icon"]',
			];
			const existingIcons = document.querySelectorAll<HTMLLinkElement>(iconSelectors.join(","));

			if (existingIcons.length > 0) {
				existingIcons.forEach((el) => {
					el.href = config.favicon;
					el.type = config.faviconType;
				});
			} else {
				const link = document.createElement("link");
				link.rel = "icon";
				link.href = config.favicon;
				link.type = config.faviconType;
				document.head.appendChild(link);
			}

			let appleLink = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
			if (!appleLink) {
				appleLink = document.createElement("link");
				appleLink.rel = "apple-touch-icon";
				document.head.appendChild(appleLink);
			}
			appleLink.href = config.appleIcon;
		};

		// 2. Mise à jour dynamique du SEO et métadonnées d'onglet
		const updateMeta = () => {
			// Theme-color (barre d'adresse Safari iOS & Chrome Android)
			let themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
			if (!themeMeta) {
				themeMeta = document.createElement("meta");
				themeMeta.name = "theme-color";
				document.head.appendChild(themeMeta);
			}
			themeMeta.content = config.themeColor;

			// OG Site Name
			let ogSite = document.querySelector<HTMLMetaElement>('meta[property="og:site_name"]');
			if (!ogSite) {
				ogSite = document.createElement("meta");
				ogSite.setAttribute("property", "og:site_name");
				document.head.appendChild(ogSite);
			}
			ogSite.content = config.siteName;

			// Titre d'onglet racine
			if (pathname === "/" || pathname === "") {
				document.title = UNIVERSE_CONFIGS.association.rootTitle;
			} else if (pathname === "/wiki" || pathname === "/wiki/") {
				document.title = UNIVERSE_CONFIGS.wiki.rootTitle;
			} else if (pathname === "/achillea" || pathname === "/achillea/") {
				document.title = UNIVERSE_CONFIGS.esport.rootTitle;
			}
		};

		updateFavicon();
		updateMeta();
		prevDomaineRef.current = activeDomaine;
	}, [pathname, activeDomaine]);

	return null;
}

export default DynamicUniverseHead;
