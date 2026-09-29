import type { Metadata } from "next";
import localFont from "next/font/local";
import { Noto_Sans_JP, Newsreader, JetBrains_Mono } from "next/font/google";
import "./globals.css";
// Conséquences de la barre de navigation basse (réserve sous le contenu,
// remontée des pastilles flottantes et du bandeau de consentement).
import "@shenron/ui/barre-nav.css";
import dynamic from "next/dynamic";
import { GoogleTagManager, GoogleAnalytics } from "@next/third-parties/google";
import { SiteNav } from "@/components/SiteNav";
import { LocaleProvider } from "@/lib/i18n/client";
import { SiteFooter } from "@/components/SiteFooter";
import { BarreNavMobile } from "@/components/BarreNavMobile";
import { PageTransition } from "@/components/PageTransition";
import { NavigationProgress } from "@/components/NavigationProgress";
import { PageViewTracker } from "@/components/PageViewTracker";
import { ConsentGate } from "@/components/ConsentGate";
import { SiteJsonLd } from "@/components/SiteJsonLd";
import { DISCORD_CDN } from "@shenron/config/public-urls";
import { API_ORIGIN, ASSET_ORIGIN, CDN_ORIGIN, SITE_URL } from "@/lib/config";
import { env } from "@/lib/env";
import { getSiteTheme } from "@/lib/theme-config";
import { themeCssVars } from "@/lib/site-theme";
import Script from "next/script";
import type { ComponentType, ScriptHTMLAttributes } from "react";

// FAB Discord lazy : composant client gated par localStorage, jamais critical.
const DiscordInviteFAB = dynamic(() =>
	import("@/components/DiscordInviteFAB").then((m) => m.DiscordInviteFAB)
);

// Bouton flottant « Signaler une erreur » (îlot client, jamais critical).
const ReportButton = dynamic(() => import("@/components/ReportButton").then((m) => m.ReportButton));

// Google Sans Flex — police officielle Google, open-source 2025 (variable font,
// axes opsz 6→144 + wght 1→1000). Servie en local depuis le woff2 v20 de
// fonts.gstatic.com (next/font/google ne l'a pas encore dans son registry).
// Sert à la fois de corps (--font-sans) ET de police d'affichage (--font-display,
// mappé dans globals.css) : hiérarchie pilotée par le poids, façon design Google.
const sansFlex = localFont({
	src: "../../public/fonts/google-sans-flex.woff2",
	variable: "--font-sans",
	display: "swap",
	weight: "1 1000", // axe wght variable
	// Best practices next/font : préchargé (défaut), fallback à métriques
	// ajustées (`size-adjust` auto sur Arial) → zéro layout shift au swap.
	fallback: ["system-ui", "arial"],
	adjustFontFallback: "Arial",
});

// Newsreader — serif éditoriale variable (axe opsz + wght, italique vrai).
// Police d'affichage du wiki : le contraste serif/sans est ce qui fait passer
// une fiche d'un « bloc de texte » à un article. Preload (elle porte les H1/H2
// au-dessus de la ligne de flottaison), fallback métrique sur Times.
const newsreader = Newsreader({
	variable: "--font-serif-src",
	subsets: ["latin", "latin-ext"],
	display: "swap",
	style: ["normal", "italic"],
	adjustFontFallback: true,
});

// JetBrains Mono — métadonnées, chiffres, code, libellés HUD (`font-scouter`).
// Chargée en 400/500 seulement : elle ne sert jamais à du corps de texte.
const jetbrainsMono = JetBrains_Mono({
	variable: "--font-mono-src",
	subsets: ["latin"],
	weight: ["400", "500"],
	display: "swap",
	preload: false,
});

// Noto Sans JP — corps japonais (noms natifs 孫悟空…). Pas de preload : chargé
// seulement quand du texte JP est présent, pour ne pas peser sur le LCP latin.
const notoJP = Noto_Sans_JP({
	variable: "--font-jp",
	subsets: ["latin"],
	weight: ["400", "500", "700"],
	display: "swap",
	preload: false,
});

// SaiyanSans + DBSScouter ne sont plus chargées : les tokens `font-saiyan` et
// `font-scouter` sont remappés sur Google Sans Flex (globals.css) pour la
// lisibilité — DBSScouter rendait des glyphes aliens illisibles. Aucun
// composant ne charge donc ces .ttf décoratifs.

export const metadata: Metadata = {
	metadataBase: new URL(SITE_URL),

	title: {
		default: "DBFR — Dragon Ball France",
		template: "%s — DBFR",
	},
	description:
		"Un voyage à travers l'univers Dragon Ball en français : personnages, sagas, planètes, films, jeux et actualités anime + manga.",
	applicationName: "DBFR",
	keywords: ["Dragon Ball", "Dragon Ball Z", "Dragon Ball Super", "Daima", "wiki", "manga", "databook", "Akira Toriyama", "canon", "encyclopédie", "ドラゴンボール"],
	robots: {
		index: true,
		follow: true,
		googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 },
	},
	manifest: "/manifest.webmanifest",
	icons: {
		icon: [
			{ url: "/favicon.ico", sizes: "any" },
			{ url: "/favicon-16.png", type: "image/png", sizes: "16x16" },
			{ url: "/favicon-32.png", type: "image/png", sizes: "32x32" },
			{ url: "/favicon-48.png", type: "image/png", sizes: "48x48" },
			{ url: "/favicon-96.png", type: "image/png", sizes: "96x96" },
		],
		apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
		shortcut: "/favicon.ico",
		other: [{ rel: "mask-icon", url: "/safari-pinned-tab.svg", color: "#e78220" }],
	},
	openGraph: {
		type: "website",
		locale: "fr_FR",
		siteName: "DBFR",
		// Image OG par défaut = `app/opengraph-image.tsx` (carte de marque 1200×630,
		// générée à la volée), héritée par toutes les routes sans image propre.
	},
	twitter: {
		card: "summary_large_image",
	},
	// Uniquement si la vraie valeur est posée en env — pas de placeholder factice
	// dans le <head> (bruit Search Console / meta AdSense inerte sinon).
	verification: env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
		? { google: env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION }
		: undefined,
	other: {
		// Tuile Windows : pas de browserconfig.xml, les deux meta suffisent.
		"msapplication-TileColor": "#0a0a0a",
		"msapplication-TileImage": "/mstile-150.png",
		...(env.NEXT_PUBLIC_ADSENSE_CLIENT
			? { "google-adsense-account": env.NEXT_PUBLIC_ADSENSE_CLIENT }
			: {}),
	},
};

export const viewport = {
	themeColor: "#0a0a0a",
	colorScheme: "dark" as const,
};

const AdsScript = Script as ComponentType<ScriptHTMLAttributes<HTMLScriptElement> & { strategy?: "afterInteractive" }>;

export default async function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	const gtmId = env.NEXT_PUBLIC_GTM_ID || "GTM-KLSS5787";
	// Thème de design global (éditeur /admin/design). Sans thème posé → chaîne vide
	// → aucune injection, la palette d'origine de globals.css s'applique. Lecture
	// DB sans cookies/headers → cache CDN préservé sur toutes les pages.
	const themeCss = themeCssVars(await getSiteTheme());

	return (
		<html lang="fr" className="dark">
			<head>
				{/* Toutes les images, vidéos et cartes de profil du site viennent du bot :
				    100 requêtes vers cette origine sur une page de liste. Sans
				    `preconnect`, le navigateur paie DNS + TCP + TLS avant la PREMIÈRE
				    d'entre elles — un aller-retour complet, avant tout octet d'image.
				    `crossOrigin` est requis pour que la connexion préouverte serve
				    aussi les requêtes CORS (vidéos, fetch). */}
				{/* Preconnect & DNS-prefetch vers le CDN principal et les sources d'assets */}
				<link rel="preconnect" href={ASSET_ORIGIN} />
				<link rel="preconnect" href={ASSET_ORIGIN} crossOrigin="anonymous" />
				<link rel="dns-prefetch" href={ASSET_ORIGIN} />
				<link rel="preconnect" href={CDN_ORIGIN} />
				<link rel="preconnect" href={CDN_ORIGIN} crossOrigin="anonymous" />
				<link rel="dns-prefetch" href={CDN_ORIGIN} />
				<link rel="preconnect" href={API_ORIGIN} />
				<link rel="preconnect" href={API_ORIGIN} crossOrigin="anonymous" />
				<link rel="dns-prefetch" href={API_ORIGIN} />
				<link rel="dns-prefetch" href="https://comic.dragonballcn.com" />
				<link rel="dns-prefetch" href="https://s4.anilist.co" />
				<link rel="dns-prefetch" href={DISCORD_CDN} />
				<link rel="dns-prefetch" href="https://image.tmdb.org" />
				{/* Préchargement critique de la police principale Google Sans Flex */}
				<link
					rel="preload"
					href="/fonts/google-sans-flex.woff2"
					as="font"
					type="font/woff2"
					crossOrigin="anonymous"
				/>

				{/* Initialisation par défaut du Consent Mode v2 de Google avant le chargement des scripts */}
				<script
					dangerouslySetInnerHTML={{
						__html: `
							window.dataLayer = window.dataLayer || [];
							function gtag(){window.dataLayer.push(arguments);}
							gtag('consent', 'default', {
								'analytics_storage': 'denied',
								'ad_storage': 'denied',
								'ad_user_data': 'denied',
								'ad_personalization': 'denied'
							});
						`,
					}}
				/>
				{/* Thème de design global surchargeant les tokens `--dbz-*` (voir globals.css). */}
				{themeCss && (
					<style id="site-theme" dangerouslySetInnerHTML={{ __html: `:root{${themeCss}}` }} />
				)}
			</head>
			{/* Google Tag Manager — injecté via le composant officiel @next/third-parties */}
			<GoogleTagManager gtmId={gtmId} />
			{/* Google Analytics GA4 — seulement si une vraie property est posée en env
			    (sinon GA4 est déjà géré par le conteneur GTM ci-dessus). */}
			{env.NEXT_PUBLIC_GA_ID && <GoogleAnalytics gaId={env.NEXT_PUBLIC_GA_ID} />}
			{/* Google AdSense Script */}
			{env.NEXT_PUBLIC_ADSENSE_CLIENT && (
				<AdsScript
					src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${env.NEXT_PUBLIC_ADSENSE_CLIENT}`}
					crossOrigin="anonymous"
					strategy="afterInteractive"
				/>
			)}
			<body
				className={`${sansFlex.variable} ${newsreader.variable} ${jetbrainsMono.variable} ${notoJP.variable} antialiased min-h-screen relative flex flex-col font-sans bg-dbz-bg text-white`}
			>
				{/* GTM noscript — fallback sans JS, juste après l'ouverture de <body>. */}
				<noscript>
					<iframe
						src={`https://www.googletagmanager.com/ns.html?id=${gtmId}`}
						height="0"
						width="0"
						style={{ display: "none", visibility: "hidden" }}
						title="Google Tag Manager"
					/>
				</noscript>
				{/* Données structurées site (Organization + WebSite/SearchAction) —
				    rendues sur toutes les pages, inertes, sans cookie/header. */}
				<SiteJsonLd />
				{/* Progress bar scroll natif (animation-timeline: scroll(root)) */}
				<div className="scroll-progress" aria-hidden />
				{/* Nébuleuse de fond — couche FIXE (viewport) plutôt que
				    `background-attachment: fixed` sur <body>, ignoré sur mobile
				    (sinon le dégradé s'étire sur tout le document → haut des pages
				    longues trop sombre). Rendue avant le starfield (passe dessous). */}
				<div className="fixed inset-0 z-[-1] pointer-events-none nebula-bg" aria-hidden />
				{/* Starfield drift cosmique — fixe en arrière-plan, pure CSS */}
				<div
					className="fixed inset-0 z-[-1] pointer-events-none starfield starfield-anim opacity-80"
					aria-hidden
				/>
				{/* Évitement de navigation (WCAG 2.4.1) — premier élément focusable du
				    document, visible seulement au clavier. Sans lui, un utilisateur au
				    clavier ou au lecteur d'écran retraverse toute la nav (+ le menu
				    « Plus ») à chaque page avant d'atteindre le contenu. */}
				<a href="#contenu" className="skip-link">
					Aller au contenu
				</a>
				<NavigationProgress />
				<PageViewTracker />
				{/* La langue d'interface vit dans un contexte CLIENT : lire le cookie
				    ici rendrait tout le site dynamique et tuerait le cache CDN. */}
				<LocaleProvider>
					<SiteNav />
					<main id="contenu" tabIndex={-1} className="relative z-10 flex-1 w-full flex flex-col">
						<PageTransition>{children}</PageTransition>
					</main>
					<SiteFooter />
				{/* Barre de navigation basse — sous 1024 px seulement, là où la nav de
				    la barre du haut se replie. Elle est montée APRÈS le pied de page :
				    l'ordre du DOM est aussi l'ordre de tabulation, et une navigation
				    de premier rang qui s'insère avant le pied ferait relire tout le
				    pied avant d'y arriver. */}
					<BarreNavMobile />
				</LocaleProvider>
				<DiscordInviteFAB />
				<ReportButton />
				{/* L'assistant flottant est retiré des pages publiques (2026-09-12).
				    C'était un bouton rond à anneau dégradé, halo flou, survol qui
				    grossit de 10 % et un emoji pour visage — tout ce que DESIGN.md
				    écarte (« pas d'emoji dans l'interface », « aucun dégradé », « les
				    seuls halos autorisés sont les auras de ki sur des blocs de
				    héros ») — et il annonçait sur chaque page, article compris, que le
				    site répond par une IA. L'assistant reste disponible sur sa propre
				    page, `/ask`, où c'est le sujet. */}
				<ConsentGate />
			</body>
		</html>
	);
}
