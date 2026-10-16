import "./globals.css";

import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";

import { lato, notoSans, poppins, roboto } from "@/lib/fonts";
import { NETWORK_SAME_AS } from "@/lib/social-links";
import { absoluteUrl, SITE_URL } from "@/lib/site-url";
import { Geist } from "next/font/google";

import { GoogleTagManager } from "@next/third-parties/google";
import { resolveLocale } from "@rosegriffon/i18n";
import { isLocaleId } from "@rosegriffon/preferences";
import { ADSENSE_CLIENT, AdSenseScript } from "@rosegriffon/ui";

import ClientLayout from "./client-layout";

/** Conteneur Google Tag Manager. Absent = aucune balise injectée. */
const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID;

/**
 * Script anti-scintillement pour le chrome applicatif (barre latérale, en-tête).
 *
 * Il garantit que `<html>` porte immédiatement la classe du thème chrome
 * dès la première peinture sans aucun FOUC.
 * Les thèmes de contenu (Azalée sombre pour le wiki, Achilléa pour l'e-sport)
 * sont appliqués isolément sur `#main-content`, préservant la lisibilité
 * et la stabilité de la barre latérale et de la barre supérieure.
 */
const SCRIPT_THEME = `(function(){try{var t=localStorage.getItem('rg-theme');var valid=['roy','gaelle','azalee-light','azalee-dark','achillea'];var theme=(t&&valid.indexOf(t)!==-1)?t:'roy';var cl=document.documentElement.classList;for(var i=0;i<valid.length;i++){cl.remove(valid[i],'theme-'+valid[i]);}cl.add(theme);}catch(e){document.documentElement.classList.add('roy');}})();`;

const geistSans = Geist({
	display: "swap",
	subsets: ["latin"],
	variable: "--font-geist-sans",
});

export const viewport: Viewport = {
	initialScale: 1,
	themeColor: "#a14b3f",
	viewportFit: "cover",
	width: "device-width",
	// MaximumScale et userScalable supprimés pour accessibilité WCAG
};

export const metadata: Metadata = {
	alternates: {
		// PAS de `canonical` ici. Les métadonnées Next sont héritées : un canonical
		// posé sur le layout racine s'applique à toute page qui n'en déclare pas un,
		// et /projets, /evenements, /community, /legal/*, /shop, /shop/<produit>
		// et les chroniques annonçaient donc toutes « la page canonique, c'est
		// l'accueil » — soit l'instruction explicite de ne pas les indexer. L'accueil
		// pose le sien dans `app/page.tsx` ; chaque page publique pose le sien.
		types: {},
	},
	appleWebApp: {
		capable: true,
		statusBarStyle: "default",
		title: "Rose Griffon",
	},
	authors: [{ name: "Rose Griffon" }],
	creator: "Association Rose Griffon",
	description:
		"Site officiel de l'association Rose Griffon, rassemblant la communauté Inazuma Eleven en France. Découvrez nos événements, projets et rejoignez-nous !",
	formatDetection: {
		telephone: false,
	},
	// Pas de champ `icons` ici : les fichiers `favicon.ico`, `icon.png` et
	// `apple-icon.png` de `app/` ont la priorité sur l'objet `metadata` et
	// suffisent. Le déclarer en plus émettait un second `rel="icon"` et un
	// `apple-touch-icon` en WebP, format qu'iOS n'accepte pas pour cette balise.
	keywords:
		"Rose Griffon, Inazuma Eleven, association, communauté, gaming, France, Azalée, Achilléa, Roy, Gaëlle, Inazuma Eleven France, Inazuma Eleven France Association, Inazuma Eleven France Association Rose Griffon",
	metadataBase: new URL(SITE_URL),
	// Balise de propriété AdSense. C'est ce que la vérification du tableau de bord
	// cherche dans le HTML servi ; le script seul ne suffit pas à valider le site.
	other: {
		"google-adsense-account": ADSENSE_CLIENT,
	},
	openGraph: {
		description:
			"Site officiel de l'association Rose Griffon, rassemblant la communauté Inazuma Eleven en France. Découvrez nos événements, projets et rejoignez-nous !",
		locale: "fr_FR",
		siteName: "Rose Griffon",
		title: "Rose Griffon | Association Inazuma Eleven France",
		type: "website",
		url: SITE_URL,
	},
	publisher: "Association Rose Griffon",
	robots: {
		follow: true,
		googleBot: {
			follow: true,
			index: true,
			"max-image-preview": "large",
			"max-snippet": -1,
		},
		index: true,
	},
	title: "Rose Griffon | Association Inazuma Eleven France",
	twitter: {
		card: "summary_large_image",
		creator: "@rose_griffon",
		description:
			"Site officiel de l'association Rose Griffon, rassemblant la communauté Inazuma Eleven en France",
		title: "Rose Griffon | Association Inazuma Eleven France",
	},
};

export default async function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
	const locale = resolveLocale({
		acceptLanguage: headerStore.get("accept-language"),
		cookieLocale: cookieStore.get("rg-locale")?.value,
	});
	const initialLanguage = isLocaleId(locale.locale) ? locale.locale : "fr";

	return (
		<html lang={initialLanguage} dir={locale.direction} suppressHydrationWarning>
			<head>
				{/*
				 * Pré-application du thème avant hydratation (évite le FOUC) ;
				 * `next-themes` prend le relais une fois monté. Voir `SCRIPT_THEME`
				 * ci-dessus pour le détail des trois responsabilités et des mesures
				 * de contraste qui les motivent.
				 *
				 * Il reste EN PREMIER dans le `<head>` : il doit s'exécuter avant le
				 * script que `next-themes` injecte dans le `<body>`, sinon c'est ce
				 * dernier qui gagne et repeint tout en `roy`.
				 */}
				<script dangerouslySetInnerHTML={{ __html: SCRIPT_THEME }} />
				<link rel="preconnect" href="https://cdn.discordapp.com" />
				<link rel="dns-prefetch" href="https://cdn.discordapp.com" />
				<link rel="preconnect" href="https://pagead2.googlesyndication.com" />
				<link rel="author" href="/humans.txt" />
				{/* Données structurées site-wide : Organization + WebSite (rich results Google). */}
				<script
					type="application/ld+json"
					dangerouslySetInnerHTML={{
						__html: JSON.stringify({
							"@context": "https://schema.org",
							"@graph": [
								{
									"@type": "Person",
									"@id": absoluteUrl("/#yoyo"),
									name: "yoyo",
									alternateName: "yoyo",
									jobTitle: "Développeur & fondateur",
									url: "https://x.com/yoyo__goat",
									sameAs: ["https://x.com/yoyo__goat"],
									worksFor: { "@id": absoluteUrl("/#organization") },
								},
								{
									"@type": "Organization",
									"@id": absoluteUrl("/#organization"),
									name: "Rose Griffon",
									alternateName: "Association Rose Griffon",
									url: SITE_URL,
									logo: absoluteUrl("/RG_Logo_V2.5.webp"),
									description: "Association rassemblant la communauté Inazuma Eleven en France.",
									founder: { "@id": absoluteUrl("/#yoyo") },
									// Réseau Rose Griffon : 3 domaines siblings + tous les réseaux sociaux
									// (X/YouTube/Twitch/Instagram/Discord). sameAs partagé à l'identique
									// sur website / azalee / achillea pour une entité Organization cohérente.
									sameAs: NETWORK_SAME_AS,
									subOrganization: [
										{ "@id": "https://azalee.rosegriffon.fr/#website" },
										{ "@id": "https://achillea.rosegriffon.fr/#website" },
									],
								},
								{
									"@type": "WebSite",
									"@id": absoluteUrl("/#website"),
									url: SITE_URL,
									name: "Rose Griffon",
									inLanguage: "fr-FR",
									publisher: { "@id": absoluteUrl("/#organization") },
									creator: { "@id": absoluteUrl("/#yoyo") },
								},
							],
						}),
					}}
				/>
				<script
					type="speculationrules"
					dangerouslySetInnerHTML={{
						__html: JSON.stringify({
							prefetch: [
								{
									where: {
										and: [
											{ href_matches: "/*" },
											{ not: { href_matches: "/admin/*" } },
											{ not: { href_matches: "/api/*" } },
											{ not: { selector_matches: "[rel~=nofollow]" } },
										],
									},
									eagerness: "moderate",
								},
							],
						}),
					}}
				/>
			</head>
			<body
				className={`${geistSans.variable} ${roboto.className} ${roboto.variable} ${poppins.variable} ${notoSans.variable} ${lato.variable}`}
				suppressHydrationWarning
			>
				{/* Google Tag Manager — composant officiel de `@next/third-parties`.
			    Il injecte le script du conteneur ET l'`<iframe>` de repli `noscript`,
			    en respectant la stratégie de chargement de Next : pas de balise collée
			    à la main dans le `<head>`, qui bloquerait le rendu.
			    L'identifiant vient de l'environnement : sans lui, rien n'est chargé,
			    ce qui laisse les environnements de développement propres. */}
				{GTM_ID && <GoogleTagManager gtmId={GTM_ID} />}
				{/* Google AdSense — chargeur unique du site. Les annonces automatiques
				    sont pilotées depuis le tableau de bord, donc aucune page n'a
				    d'emplacement à déclarer. La CSP de rosegriffon.fr est posée par
				    nginx (`infra/nginx/rg-csp-website.inc`) : y ajouter les hôtes
				    publicitaires avant toute bascule en mode bloquant. */}
				<AdSenseScript />
				<ClientLayout initialLanguage={initialLanguage}>{children}</ClientLayout>
			</body>
		</html>
	);
}
