import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { ownImageRemotePatterns, resolveApiUrl, resolveSiteUrl } from "@shenron/config/public-urls";
import { sitePublicRedirects } from "@shenron/images/resolve";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const monorepoRoot = path.resolve(__dirname, "../../..");
const prosemirrorTransform = path.resolve(__dirname, "node_modules/prosemirror-transform");
const cdnUrl = process.env.NEXT_PUBLIC_CDN_URL?.trim().replace(/\/+$/, "");

const nextConfig: NextConfig = {
	reactStrictMode: true,
	// TypeScript 7 is checked by the workspace gate (`bun run type-check`).
	// Next 16's embedded CLI resolver misreads the Bun workspace tsc path as a
	// git package (`@C:/.../tsc.js`) during production builds.
	typescript: { ignoreBuildErrors: true },
	// Repli documenté pour les VPS contraints : Webpack sans minification évite
	// le pic mémoire du minifieur lors d'un build à froid. L'option est activée
	// uniquement par la pipeline locale de secours et ne change pas les builds
	// Turbopack habituels.
	webpack(config, { dev }) {
		config.resolve.alias = { ...config.resolve.alias, "prosemirror-transform": prosemirrorTransform };
		if (!dev && process.env.SHENRON_BUILD_LOW_MEMORY === "1") {
			config.optimization.minimize = false;
		}
		return config;
	},
	// Serveur de développement seulement. Sans cette liste, `next dev` répond
	// **403** à toute requête `/_next/*` portant un en-tête `Origin` — donc à une
	// partie des chunks demandés par le navigateur : la page se rend mais ne
	// s'hydrate jamais, et TOUT devient incliquable. C'est un piège coûteux quand
	// on audite justement des clics morts : le symptôme est identique à un bug
	// applicatif. Aucune incidence en production (`next start` ignore ce champ).
	allowedDevOrigins: ["127.0.0.1", "localhost", new URL(resolveSiteUrl(process.env)).host],
	// Protection contre le version skew (self-hosting `next start` solo, sans le
	// skew-protection Vercel). SHA court injecté par le workflow de build
	// `site-artifact` (`NEXT_DEPLOYMENT_ID`). Les assets portent `?dpl=<id>` et les
	// navigations un header `x-deployment-id` ; sur mismatch, Next force un reload
	// dur au lieu de throw `Failed to find Server Action` côté client périmé.
	// Undefined en dev local → ignoré. Cf. node_modules/next/dist/docs/.../self-hosting.md.
	deploymentId: process.env.NEXT_DEPLOYMENT_ID,
	// Les chunks versionnés de Next peuvent être servis par le CDN. Cette option
	// ne concerne que `/_next/static` ; les fichiers `public/` et les routes API
	// gardent leurs URL explicites afin de ne pas mélanger contenu et sessions.
	assetPrefix: cdnUrl || undefined,

	// Pas de `x-powered-by: Next.js` : la version exacte du framework est une
	// info gratuite pour un scan automatisé, et elle ne sert à personne côté client.
	poweredByHeader: false,

	// Désactivation explicite des source maps navigateur en production :
	// évite la surconsommation de mémoire au build Turbopack et supprime les fichiers .map.
	productionBrowserSourceMaps: false,

	// Répertoire de sortie pilotable par env. Le workflow `site-artifact` bâtit
	// dans `.next-build` hors VPS pour garder la release active indépendante du
	// build. Repartir d'un répertoire vide force aussi un build froid. Mesuré le
	//      2026-08-14 : à froid ~8,1 Gio de RSS, en incrémental (cache Turbopack
	//      déjà présent) ~10,5 Gio → OOM killer sur ce VPS de 11 Gio.
	// Au runtime, aucun slot ne pose la variable : `next start` lit bien `.next`.
	distDir: process.env.NEXT_DIST_DIR ?? ".next",

	// PAS de `output: "standalone"` — testé le 2026-08-14, refusé pour cause de
	// mémoire : le file tracing (nft) sur ce monorepo fait passer le build de
	// ~8,1 à ~10,4 Gio de RSS et le fait tuer par l'OOM killer sur ce VPS (11 Gio).
	// L'artefact est ensuite consommé par `aphrody-infra`, qui gère les releases
	// et le rollback. Le dépôt Shenron ne bascule pas de slot localement.

	// View Transitions API (React `<ViewTransition>`) — morph d'élément partagé
	// grille→fiche, slides directionnels. Sans support navigateur, navigation
	// normale sans animation (progressive enhancement). Cf. components/ViewTransition.tsx.
	//
	// Plus de drapeau `experimental.viewTransition` depuis Next 16.4-canary : la
	// clé a disparu de `ExperimentalConfig` (le type-check la refuse) parce que
	// la fonctionnalité est stabilisée — l'App Router de Next 16 tourne sur la
	// canary de React, qui expose `<ViewTransition>` sans rien à activer.
	// Configuration Turbopack explicite (requise par Next.js 16 pour satisfaire
	// validateTurboNextConfig et supporter les builds turbopack sans conflit)
	// `@shenron/images` est consommé depuis ses sources TypeScript (pas de dist) :
	// Turbopack doit le transpiler comme du code du site.
	transpilePackages: ["@aphrody/admin-ui", "@shenron/images", "@shenron/db", "@shenron/auth", "@shenron/pipeline", "@shenron/api", "@shenron/ui", "@shenron/config"],

	turbopack: {
		root: monorepoRoot,
		resolveAlias: { "prosemirror-transform": "./node_modules/prosemirror-transform" },
	},

	experimental: {
		// Repli de build pour les hôtes contraints : `next build --webpack`
		// active ce mode afin de réduire le pic mémoire au prix d'un build plus lent.
		// Sans effet sur le chemin Turbopack habituel.
		webpackMemoryOptimizations: true,
		// Type-check via the TypeScript 7 native CLI (fixed decision 1, docs/STACK.md).
		useTypeScriptCli: true,
		// Parallélisme de la génération statique — soupape mémoire éprouvée du build.
		// Borner à 1 CPU et 2 de concurrence statique évite l'explosion RSS sur VPS.
		...(process.env.BUILD_CPUS ? { cpus: Number(process.env.BUILD_CPUS) } : { cpus: 1 }),
		...(process.env.BUILD_STATIC_CONCURRENCY
			? { staticGenerationMaxConcurrency: Number(process.env.BUILD_STATIC_CONCURRENCY) }
			: { staticGenerationMaxConcurrency: 2 }),
		// Le déploiement repart volontairement d'un `.next-build` vide et le purge
		// après publication. La documentation Next 16.4 recommande de couper le
		// cache filesystem quand `.next/cache` n'est jamais restauré : l'écrire ne
		// ferait qu'ajouter des E/S et du disque sans accélérer le build suivant.
		turbopackFileSystemCacheForBuild: false,
		optimizePackageImports: [
			"lucide-react",
			"schema-dts",
			"postgres",
			"date-fns",
			"@tanstack/react-query",
			"motion",
			"better-auth",
			"@tiptap/core",
			"@tiptap/react",
		],
	},

	// Image optimization Vercel CDN — AVIF prioritaire, WebP fallback.
	// Docs : https://nextjs.org/docs/app/api-reference/components/image#formats
	// Note : chaque format est caché séparément (storage ↑ mais latence ↓ après warm).
	images: {
		// Optimisation RÉTABLIE (elle était coupée globalement). Le motif d'origine
		// — sur Vercel, une image remplacée depuis l'admin restait figée à jamais —
		// ne s'applique plus depuis l'auto-hébergement : l'optimiseur local expire
		// son cache disque selon le `Cache-Control` de la source. Et les seules
		// images réellement remplaçables en place (`assets/wiki/**`) sont exclues
		// une par une, cf. `lib/images.ts` + `isEditableAsset`.
		//
		// L'enjeu : une vignette d'épisode passe de ~60 Kio (JPEG source) à ~15 Kio
		// (AVIF à la largeur rendue), soit −73 % ; les pages de liste en portent
		// jusqu'à 85.
		formats: ["image/avif", "image/webp"],
		// Requis depuis Next 16 : sans liste blanche, n'importe qui peut faire
		// recalculer l'image à toutes les qualités. Une seule valeur suffit ici.
		qualities: [70],
		// Plancher du cache disque (`.next/cache/images`). Le TTL réel est le
		// MAXIMUM de cette valeur (4 h, défaut Next 16) et du `max-age` de la source : 1 jour pour
		// `/assets/**`, un an pour `/db/**` (immuable). `aphrody-infra` conserve
		// le cache mutable hors release :
		// sans ça, chaque mise en ligne repartait d'un cache froid et refaisait
		// toutes les transformations sur un VPS déjà juste en mémoire.
		minimumCacheTTL: 14400,
		// Vignettes de grille : le site n'a pas de rendu au-delà de ~640 px de large
		// pour une carte. Restreindre la liste évite de faire calculer — et stocker —
		// des variantes que personne ne demande.
		imageSizes: [64, 96, 128, 192, 256, 384],
		deviceSizes: [640, 828, 1080, 1200, 1920],
		// Bot expose les assets DB via /db/* (Cache-Control immutable + Vary:Accept côté bot).
		remotePatterns: [
			// Origines propres (CDN, API/assets du bot, site, Discord) : dérivées des
			// mêmes variables que `@/lib/config` via `@shenron/config/public-urls`.
			...ownImageRemotePatterns(process.env),
			// Posters films (MyAnimeList), news officielles (DB Official).
			{ protocol: "https", hostname: "myanimelist.net", pathname: "/**" },
			{
				protocol: "https",
				hostname: "fr.dragon-ball-official.com",
				pathname: "/**",
			},
			{
				protocol: "https",
				hostname: "www.dragon-ball-official.com",
				pathname: "/**",
			},
			// Les OpenGraph du portail japonais utilisent l'hôte nu (sans `www`).
			// Sans cette entrée, les 12 actus importées sont lisibles mais leurs
			// couvertures font échouer `next/image` à l'exécution.
			{
				protocol: "https",
				hostname: "dragon-ball-official.com",
				pathname: "/**",
			},
			{
				protocol: "https",
				hostname: "s4.anilist.co",
				pathname: "/**",
			},
			{
				protocol: "https",
				hostname: "cdn.myanimelist.net",
				pathname: "/**",
			},
			// Stills d'épisodes (TMDB).
			{ protocol: "https", hostname: "image.tmdb.org", pathname: "/**" },
			{
				protocol: "https",
				hostname: "media.kitsu.io",
				pathname: "/**",
			},
			// Scans et couvertures DragonBallCN (archive HD)
			{ protocol: "https", hostname: "comic.dragonballcn.com", pathname: "/**" },
			{ protocol: "http", hostname: "comic.dragonballcn.com", pathname: "/**" },
		],
		dangerouslyAllowSVG: false,
	},

	compress: true,

	// Dédoublonnage des anciennes routes films (id-based, API) vers la source
	// canonique /wiki/films (Neon, slug-based). Redirect au niveau routing → 308
	// dur avant tout rendu (un redirect() en composant dégradait en navigation
	// client 200 à cause du layout /wiki force-dynamic qui flush en streaming).
	async redirects() {
		return [
			// Copies binaires dédoublonnées de `public/` (manifeste
			// `@shenron/images/asset-aliases.json`) : l'ancienne URL garde sa réponse.
			...sitePublicRedirects().map(([source, destination]) => ({
				source: source.replace(/[():*+?{}]/g, "\\$&"),
				destination,
				permanent: true,
			})),
			// Consolidation éditoriale : les anciens index ne sont plus des
			// destinations autonomes. Les détails conservés restent accessibles aux
			// liens d'archives, mais les entrées publiques convergent vers leur hub.
			{ source: "/wiki/arcs", destination: "/wiki/sagas", permanent: true },
			{ source: "/wiki/arcs/:path*", destination: "/wiki/sagas", permanent: true },
			{ source: "/wiki/combats/:path*", destination: "/wiki/evenements", permanent: true },
			{ source: "/wiki/tournois/:path*", destination: "/wiki/evenements", permanent: true },
			{ source: "/wiki/dragons/:path*", destination: "/wiki/personnages", permanent: true },
			{ source: "/wiki/voix/:path*", destination: "/wiki/staff", permanent: true },
			{ source: "/wiki/romans/:path*", destination: "/wiki/manga", permanent: true },
			// Ancienne vue série épisodes par query (`?series=X`) → route dédiée
			// STATIQUE `/wiki/episodes/serie/X` (la landing est passée statique pour
			// débloquer l'interception @modal + le cache CDN). Capture la valeur du
			// query dans `:series`. `page`/`view` obsolètes (grille complète).
			{
				source: "/wiki/episodes",
				has: [{ type: "query", key: "series", value: "(?<series>[^&]+)" }],
				destination: "/wiki/episodes/serie/:series",
				permanent: true,
			},
			{ source: "/wiki/dragon-ball/movies", destination: "/wiki/films", permanent: true },
			{ source: "/wiki/dragon-ball/movie/:id", destination: "/wiki/films", permanent: true },
			// Ancien index « Encyclopédie » fourre-tout → page Personnages dédiée.
			// 308 dur au routing (un permanentRedirect() en composant dégradait en
			// page 200 + <meta refresh>, cf. layout /wiki en streaming). Les routes
			// détail enfants (/wiki/dragon-ball/character|planet|techniques/…) ne
			// sont PAS capturées : la source est le chemin exact, sans wildcard.
			{ source: "/wiki/dragon-ball", destination: "/wiki/personnages", permanent: true },
			{ source: "/profil", destination: "/profil/me", permanent: true },
			// Journal : la fiche article vivait sous /post/:slug alors que l'index et
			// ── Unification intégrale : Articles, Journal, Actualités, CMS → /news ──
			// Consolidation sous le service unique canonique https://dragonballfr.com/news
			{ source: "/actualites", destination: "/news", permanent: true },
			{ source: "/actualites/:slug", destination: "/news/:slug", permanent: true },
			{ source: "/actualites/page/:n", destination: "/news/page/:n", permanent: true },
			{ source: "/actualites/theme/:tag", destination: "/news/theme/:tag", permanent: true },
			{ source: "/actualites/rss.xml", destination: "/news/rss.xml", permanent: true },
			{ source: "/articles", destination: "/news", permanent: true },
			{ source: "/articles/:slug", destination: "/news/:slug", permanent: true },
			{ source: "/article/:slug", destination: "/news/:slug", permanent: true },
			{ source: "/journal", destination: "/news", permanent: true },
			{ source: "/journal/:slug", destination: "/news/:slug", permanent: true },
			{ source: "/cms", destination: "/news", permanent: true },
			{ source: "/cms/:slug", destination: "/news/:slug", permanent: true },
			{ source: "/posts", destination: "/news", permanent: true },
			{ source: "/post/:slug", destination: "/news/:slug", permanent: true },
			{ source: "/wiki/news", destination: "/news", permanent: true },
			// Flux public des révisions du wiki, retiré le 2026-09-12 : il racontait la
			// fabrication du site au lieu de Dragon Ball. 308 au ROUTING et non
			// `permanentRedirect()` dans la page — mesuré en production le même jour,
			// sous le layout `/wiki` (streaming) ce dernier dégradait en page 200 +
			// `<meta http-equiv="refresh">`, donc un lien toujours vivant pour les robots.
			{ source: "/wiki/modifications", destination: "/news", permanent: true },
			// ── Unification Toriyama & Doctrine Canon → /wiki/canon ──
			{
				source: "/wiki/akira-toriyama-tankobon-introductions",
				destination: "/wiki/canon",
				permanent: true,
			},
			{
				source: "/wiki/doctrine-artistique-akira-toriyama",
				destination: "/wiki/canon",
				permanent: true,
			},
			{ source: "/wiki/archives-akira-toriyama", destination: "/wiki/canon", permanent: true },
			// Rapatriement des fiches sous le segment de leur propre index. Le site
			// mélangeait deux conventions : l'index en français à la racine
			// (`/wiki/personnages`, `/wiki/planetes`) et la fiche en anglais sous un
			// préfixe (`/wiki/dragon-ball/character/12`, `/wiki/dragon-ball/planet/3`),
			// pendant que les rubriques voisines — races, arcs, sagas, films — vivaient
			// toutes sous un segment unique. Les techniques cumulaient : leur INDEX
			// lui-même était sous `/wiki/dragon-ball/`. Tout est désormais sous
			// `/wiki/<rubrique>[/<clé>]`, et ces 308 récupèrent l'existant.
			{
				source: "/wiki/dragon-ball/character/:id",
				destination: "/wiki/personnages/:id",
				permanent: true,
			},
			// Pointe DIRECTEMENT sur la cosmologie : passer par `/wiki/planetes/:id`
			// enchaînerait deux 308 pour un même clic.
			{
				source: "/wiki/dragon-ball/planet/:id",
				destination: "/wiki/cosmologie/:id",
				permanent: true,
			},
			// La rubrique « Planètes » est devenue « Cosmologie » : `db_planets`
			// héberge aussi des dimensions (l'Autre Monde, le Noyau du Monde), des
			// demeures divines (temple du Roi de Tout, Planète sacrée) et des univers
			// entiers — une entrée sur huit n'est pas une planète. L'ancien
			// `/wiki/planetes` n'était de toute façon qu'un `redirect()` de composant
			// vers `/wiki/personnages?tab=planetes`, qui dégradait en 200 +
			// `<meta refresh>` sous le layout `/wiki` (piège du streaming).
			{ source: "/wiki/planetes/:id", destination: "/wiki/cosmologie/:id", permanent: true },
			{ source: "/wiki/planetes", destination: "/wiki/cosmologie", permanent: true },
			{
				source: "/wiki/dragon-ball/techniques/:slug",
				destination: "/wiki/techniques/:slug",
				permanent: true,
			},
			{ source: "/wiki/dragon-ball/techniques", destination: "/wiki/techniques", permanent: true },
		];
	},

	async rewrites() {
		const botHost = resolveApiUrl(process.env);
		// `fallback` (et NON un tableau = `afterFiles`) : ce rewrite ne sert que les
		// MÉDIAS wiki (`/wiki/<asset>.mp4|webp…`) proxifiés vers le bot. En
		// `afterFiles`, il préemptait les routes dynamiques (`/wiki/films/[slug]`,
		// `/wiki/sagas/[slug]`…) sous `next start` → fiches 403 (le bot renvoyait
		// « Extension non autorisée »). En `fallback`, il ne se déclenche que si
		// AUCUNE page (statique ou dynamique) ne matche → les fiches restent à Next.
		return {
			fallback: [
				{
					source: "/wiki/:path*",
					destination: `${botHost}/assets/wiki/:path*`,
				},
			],
		};
	},

	async headers() {
		return [
			{
				source: "/_next/static/(.*)",
				headers: [
					{
						key: "Cache-Control",
						value: "public, max-age=31536000, immutable",
					},
				],
			},
			{
				source: "/fonts/(.*)",
				headers: [
					{
						key: "Cache-Control",
						value: "public, max-age=31536000, immutable",
					},
				],
			},
			{
				source: "/_next/image(.*)",
				headers: [
					{
						key: "Cache-Control",
						value: "public, max-age=86400, stale-while-revalidate=2592000",
					},
				],
			},
			{
				source: "/wiki/(.*)",
				headers: [
					{
						key: "Cache-Control",
						// Les routes wiki sont rendues avec ISR, mais leurs réglages
						// éditoriaux (bannières, chronologie…) doivent être visibles dès
						// `revalidatePath`. Le navigateur/CDN peut donc stocker mais doit
						// revalider avant chaque réemploi.
						value: "public, max-age=0, must-revalidate",
					},
				],
			},
			{
				source: "/assets/(.*)",
				headers: [
					{
						key: "Cache-Control",
						value: "public, max-age=86400, stale-while-revalidate=604800",
					},
				],
			},
			{
				source: "/(.*)\\.(ico|png|svg|webp|avif|jpg|jpeg|woff2)",
				headers: [
					{
						key: "Cache-Control",
						value: "public, max-age=604800, stale-while-revalidate=2592000",
					},
				],
			},
			{
				source: "/(.*)",
				headers: [
					{ key: "X-Content-Type-Options", value: "nosniff" },
					{ key: "X-Frame-Options", value: "SAMEORIGIN" },
					{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
					// CSP volontairement RÉDUITE aux directives qui ne peuvent rien
					// casser ici. Pas de `script-src` / `frame-src` : la page charge
					// GTM + AdSense (scripts tiers injectés dynamiquement) et embarque
					// les lecteurs vidéo des hébergeurs (vidmoly, mail.ru, yourupload…)
					// dont la liste bouge — une allowlist figée couperait la lecture.
					// Ce qui reste couvre les vecteurs réels :
					//   object-src   → plus de <embed>/<object> Flash-like injectés
					//   base-uri     → interdit de réécrire la base des URL relatives
					//   form-action  → un <form> injecté ne peut pas exfiltrer ailleurs
					//   frame-ancestors → clickjacking (doublon moderne de X-Frame-Options)
					{
						key: "Content-Security-Policy",
						value: "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
					},
					// Aucune de ces API n'est utilisée par le site : les refuser évite
					// qu'un script tiers (régie pub) puisse les demander en notre nom.
					{
						key: "Permissions-Policy",
						value:
							"camera=(), microphone=(), geolocation=(), browsing-topics=(), interest-cohort=(), payment=(), usb=()",
					},
					// L'auth Discord passe par une fenêtre OAuth → `allow-popups`, pas
					// `same-origin` strict (qui casserait le retour de callback).
					{ key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
					{ key: "X-DNS-Prefetch-Control", value: "on" },
				],
			},
			{
				// Le manifeste PWA est servi cross-origin par certains navigateurs
				// (installation) et change rarement.
				source: "/manifest.webmanifest",
				headers: [
					{ key: "Cache-Control", value: "public, max-age=3600, stale-while-revalidate=86400" },
					{ key: "Content-Type", value: "application/manifest+json; charset=utf-8" },
				],
			},
		];
	},
};

// Next.js 16 Turbopack : analyse de bundle intégrée via `next build --turbopack --experimental-analyze`
// qui écrit les métriques dans `.next/diagnostics/analyze` sans injecter de wrapper Webpack.
export default withNextIntl(nextConfig);
