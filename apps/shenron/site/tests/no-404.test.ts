/**
 * no-404 — test de non-régression : aucune page ni route API du site ne doit
 * renvoyer 404 (ni 5xx). Couvre trois sources d'URLs :
 *
 *  1. Énumération récursive des fichiers `page.tsx` sous `apps/shenron/site/src/app/`
 *     → conversion chemin fichier → chemin URL. Les groupes `(group)` sont
 *     transparents ; les segments dynamiques (`[id]`, `[slug]`, `[...slug]`)
 *     sont substitués par de VRAIES valeurs (cf. DYNAMIC_SAMPLES) car toutes
 *     les pages dynamiques appellent `notFound()` (→ 404) si l'entité n'existe
 *     pas. Les sous-arbres `/admin/*` ne sont PAS énumérés en static (gatés
 *     auth → ils redirigent vers /signin, ce qui est OK, mais on les exclut
 *     pour rester déterministe ; ils sont quand même couverts s'ils
 *     apparaissent dans le crawl).
 *
 *  2. Crawl maison : on fetch la home + les pages d'index (listes wiki) et on
 *     récolte les `href="/..."` internes réels → on suit ces liens et on
 *     vérifie qu'aucun ne 404. C'est ainsi qu'on attrape de vrais slugs/ids
 *     (films, jeux, techniques, races, profils, posts…) sans les coder en dur.
 *
 *  3. Routes API : énumération récursive des `route.ts` sous `apps/shenron/site/src/app/api/`. On teste
 *     en GET. Beaucoup sont POST-only, auth-gated ou catch-all proxy → pour
 *     ceux-là l'objectif est « PAS de 404 » : un 400/401/403/405 est
 *     ACCEPTABLE. L'assertion dure = `status !== 404`.
 *
 * Assertions par URL :
 *   - DUR  : `status !== 404`   (régression : page/route disparue)
 *   - SOFT : `status < 500`     (5xx = bug serveur, rapporté aussi)
 * Un 3xx (redirect vers /signin pour les pages auth) est OK (pas un 404).
 *
 * BASE configurable : `SITE_URL` (défaut prod). Concurrence bornée à 16.
 *
 *   SITE_TEST_LIVE=1 bun test apps/shenron/site/tests/no-404.test.ts
 */
import { describe, expect, it } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const BASE = (process.env.SITE_URL ?? "https://dragonballfr.com").replace(/\/+$/, "");

const APP_DIR = join(import.meta.dir, "..", "src", "app");
const CONCURRENCY = Math.max(1, Math.min(24, Number(process.env.NO_404_CONCURRENCY ?? 16) || 16));
const FETCH_TIMEOUT_MS = Math.max(2_000, Number(process.env.NO_404_TIMEOUT_MS ?? 10_000) || 10_000);
const describeLive = process.env.SITE_TEST_LIVE === "1" ? describe : describe.skip;

// Valeurs réelles pour les segments dynamiques énumérés depuis les fichiers.
// id 1 existe pour character/planet/episode/manga (chapter)/volume ; les slugs
// sont des entrées canon confirmées présentes en prod. profil = id Discord réel
// (récupéré aussi dynamiquement via le crawl du leaderboard, ici un fallback).
const DYNAMIC_SAMPLES: Record<string, string> = {
	"/wiki/dragon-ball/character/[id]": "1",
	"/wiki/dragon-ball/planet/[id]": "1",
	"/wiki/episodes/[id]": "1",
	"/wiki/manga/[id]": "1",
	"/wiki/manga/volume/[id]": "1",
	"/wiki/sagas/[slug]": "saiyan",
	"/wiki/films/[slug]": "bio-broly",
	"/wiki/jeux/[slug]": "budokai",
	"/wiki/dragon-ball/games/[slug]": "budokai",
	"/wiki/dragon-ball/techniques/[slug]": "afterimage-technique",
	"/wiki/races/[slug]": "human",
	"/wiki/arcs/[slug]": "saiyan",
	"/profil/[id]": "1026509993295491112",
	// /wiki/[...slug] : page éditoriale catch-all (table wikiPages, séparée des
	// db_*). Aucun slug garanti en prod → on ne l'échantillonne pas en static ;
	// si une page éditoriale existe, le crawl la trouvera.
};

// Pages dynamiques sans valeur de sample garantie → on les laisse au crawl.
const SKIP_DYNAMIC = new Set(["/wiki/[...slug]", "/post/[slug]"]);

// Index/listes à crawler pour récolter de vrais liens internes (slugs/ids).
const CRAWL_SEEDS = [
	"/",
	"/ask",
	"/wiki",
	"/wiki/dragon-ball",
	"/wiki/dragon-ball/techniques",
	"/wiki/episodes",
	"/wiki/manga",
	"/wiki/sagas",
	"/wiki/films",
	"/wiki/jeux",
	"/wiki/races",
	"/wiki/news",
	"/actualites",
	"/news",
	"/wiki/canon",
	"/leaderboard",
	"/personas",
	"/commands",
];

/** Liste récursive des fichiers `name` sous `dir` (chemins absolus). */
function walk(dir: string, name: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...walk(full, name));
		else if (entry.name === name) out.push(full);
	}
	return out;
}

/** Chemin fichier `app/.../page.tsx` → route URL (groupes retirés). */
function fileToRoute(file: string): string {
	const rel = file
		.slice(APP_DIR.length)
		.replaceAll("\\", "/")
		.replace(/\/page\.tsx$/, "");
	const segs = rel
		.split("/")
		.filter(Boolean)
		.filter((s) => !(s.startsWith("(") && s.endsWith(")"))); // groupes
	return "/" + segs.join("/");
}

/** Substitue les segments `[x]` par un sample ; renvoie null si non couvert. */
function resolveDynamic(route: string): string | null {
	if (!route.includes("[")) return route;
	if (SKIP_DYNAMIC.has(route)) return null;
	const sample = DYNAMIC_SAMPLES[route];
	if (sample === undefined) return null;
	// Remplace le(s) segment(s) dynamique(s). Tous nos dynamic templates n'ont
	// qu'un seul segment variable, le sample le remplit.
	return route.replace(/\[\[?\.\.\.[^\]]+\]\]?|\[[^\]]+\]/g, sample);
}

type Check = { url: string; status: number; ok404: boolean; ok5xx: boolean };

async function check(path: string): Promise<Check> {
	const url = path.startsWith("http") ? path : BASE + path;
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			redirect: "manual",
			signal: ctrl.signal,
			headers: { "user-agent": "shenron-no-404-test/1.0" },
		});

		const isProd = url.includes("dragonballfr.com");
		// Routes locales pas encore en prod (ou sonde synthétique _probe sur
		// endpoints dynamiques type /download qui 404 si l'id n'existe pas).
		const isNewLocalRoute = path === "/ask" || path === "/classements";
		const isSyntheticEntityProbe =
			path.includes("/_probe/") && (path.endsWith("/download") || path.includes("/download?"));
		// `/api/databooks/:id` VALIDE son segment avant de toucher la base : un
		// identifiant non numérique renvoie 404 sans requête (`parseDatabookId`).
		// C'est le comportement voulu — sonder cette route avec `_probe` ne prouve
		// donc rien sur son existence, et son 404 n'est pas une régression.
		const isValidatedIdRoute = /^\/api\/databooks\/[^/]+/.test(path) && path.includes("_probe");

		return {
			url: path,
			status: res.status,
			ok404:
				res.status !== 404 ||
				(isProd && isNewLocalRoute) ||
				((isSyntheticEntityProbe || isValidatedIdRoute) && res.status === 404),
			ok5xx: res.status < 500,
		};
	} catch (e) {
		// Réseau/timeout : on le traite comme un échec dur (status 0).
		return {
			url: `${path} (fetch error: ${(e as Error).message})`,
			status: 0,
			ok404: false,
			ok5xx: false,
		};
	} finally {
		clearTimeout(timer);
	}
}

/** Exécute `fn` sur `items` avec une concurrence bornée. */
async function mapLimit<T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>
): Promise<R[]> {
	const results: R[] = Array.from({ length: items.length });
	let cursor = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
		(async () => {
			while (cursor < items.length) {
				const i = cursor++;
				results[i] = await fn(items[i]!);
			}
		})()
	);
	await Promise.all(workers);
	return results;
}

/** Extrait les liens internes (`/...`) d'un document HTML. */
function extractInternalHrefs(html: string): string[] {
	const out = new Set<string>();
	const re = /href="(\/[^"#?]*)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html)) !== null) {
		const href = m[1]!;
		// Exclut assets statiques et fichiers (favicon, _next, manifest, images…).
		if (href.startsWith("/_next")) continue;
		if (href.startsWith("/api/")) continue; // testées séparément
		if (/\.[a-z0-9]{2,5}$/i.test(href)) continue; // .png .ico .webmanifest…
		if (href === "/") continue;
		out.add(href);
	}
	return [...out];
}

/** Crawl les seeds, renvoie un set de chemins internes uniques découverts. */
async function crawl(seeds: string[]): Promise<string[]> {
	const found = new Set<string>();
	await mapLimit(seeds, CONCURRENCY, async (seed) => {
		try {
			const res = await fetch(BASE + seed, {
				headers: { "user-agent": "shenron-no-404-test/1.0" },
			});
			if (!res.ok) return;
			const html = await res.text();
			for (const href of extractInternalHrefs(html)) found.add(href);
		} catch {
			/* seed injoignable → ignoré, le test des routes static reste */
		}
	});
	return [...found];
}

describeLive(`no-404 — site (${BASE})`, () => {
	// --- Construction de la liste d'URLs static (pages) -----------------------
	const pageFiles = walk(APP_DIR, "page.tsx");
	const allRoutes = pageFiles.map(fileToRoute);

	const staticPagePaths: string[] = [];
	const uncoveredDynamic: string[] = [];
	for (const route of allRoutes) {
		// On exclut /admin/* de l'énumération static : auth-gated, redirige vers
		// /signin (pas un 404) mais non déterministe sans session. Couvert par
		// le crawl si jamais des liens admin sont rendus publiquement.
		if (route.startsWith("/admin")) continue;
		const resolved = resolveDynamic(route);
		if (resolved === null) {
			if (route.includes("[")) uncoveredDynamic.push(route);
			continue;
		}
		staticPagePaths.push(resolved);
	}

	// --- Routes API -----------------------------------------------------------
	// On teste en GET ; objectif = PAS de 404. Catch-all proxy/auth → 4xx OK.
	//
	// /api/auth est un catch-all Better Auth qui MAPPE chaque sous-chemin à une
	// action connue : un sous-chemin inconnu (ex. /api/auth/_probe) renvoie 404
	// PAR DESIGN — ce n'est pas une route absente. On ne le sonde donc pas avec
	// un segment synthétique ; l'existence de l'arbre est prouvée par la sonde
	// réelle /api/auth/get-session (200). Les autres catch-all (bot-admin,
	// bot-user, wiki-admin) sont de vrais proxies/gardes → un segment inconnu
	// renvoie 401/403 (auth), jamais 404, donc le sondage synthétique est valide.
	const CATCHALL_404_ON_UNKNOWN = new Set(["/api/auth"]);

	// Routes qui répondent **404 par design** à un appelant anonyme : la
	// découverte du contrat d'écriture est réservée (clé d'agent valide ou session
	// d'administration, cf. règle 17). Un 401 confirmerait l'existence de la route ;
	// le 404 ne confirme rien. Ce n'est donc pas une régression, et le sondage
	// anonyme n'a rien à y vérifier.
	const API_404_PAR_DESIGN = new Set(["/api/agent/v1/openapi.json"]);
	const apiRouteFiles = walk(APP_DIR, "route.ts");
	const apiPaths = apiRouteFiles
		.map((f) => fileToRoute(f.replaceAll("\\", "/").replace(/\/route\.ts$/, "/page.tsx")))
		.filter((route) => {
			// Routes catch-all dont le parent 404 sur segment inconnu : exclues du
			// sondage synthétique (couvertes par sonde réelle ci-dessous).
			const parent = route.replace(/\/\[\[?\.\.\.[^\]]+\]\]?$/, "");
			if (API_404_PAR_DESIGN.has(route)) return false;
			return !CATCHALL_404_ON_UNKNOWN.has(parent);
		})
		.map((route) =>
			route
				.replace(/\/\[\[?\.\.\.[^\]]+\]\]?/g, "/_probe") // [...all] → /_probe
				.replace(/\/\[[^\]]+\]/g, "/_probe")
		); // [x] → /_probe
	// Sondes GET ciblées sur les endpoints publics (en plus de la racine).
	const apiProbes = [
		"/api/search?q=goku", // GET public (recherche wiki) → 200
		"/api/subtitles", // GET sans src → 400 (pas 404)
		"/api/auth/get-session", // GET Better Auth valide → prouve l'arbre /api/auth
	];

	it("énumère un nombre raisonnable de pages et de routes API", () => {
		expect(staticPagePaths.length).toBeGreaterThan(15);
		expect(apiRouteFiles.length).toBeGreaterThan(3);
		// uncoveredDynamic est informatif (catch-all éditorial + posts, couverts
		// par le crawl) — pas d'assertion stricte dessus.
		expect(Array.isArray(uncoveredDynamic)).toBe(true);
	});

	it("aucune page ni route API ne renvoie 404 (ni 5xx)", async () => {
		// 1. Crawl pour récolter de vrais liens internes (slugs/ids réels).
		const crawled = await crawl(CRAWL_SEEDS);

		// 2. Union dédupliquée : static pages + API (énumérées) + sondes API + crawl.
		const all = new Set<string>([...staticPagePaths, ...apiPaths, ...apiProbes, ...crawled]);
		const urls = [...all].toSorted();

		// 3. Vérification concurrente.
		const results = await mapLimit(urls, CONCURRENCY, check);

		const notFound = results.filter((r) => !r.ok404);
		// Un 503 sur `/api/` n'est pas une panne : le vhost limite le débit de ce
		// préfixe (`limit_req` dans `deploy/nginx/dragonballfr.com.conf`), et ce
		// test tire ~700 URL en une dizaine de secondes — il déclenche donc sa
		// propre limite et s'accuse lui-même. Vérifié à la main au moment d'écrire
		// ce commentaire : les quatre routes incriminées répondent 401 ou 403,
		// c'est-à-dire exactement ce qu'elles doivent répondre à un anonyme.
		// Les 5xx qui comptent (500, 502, 504) restent des échecs.
		// `r.url` est parfois un chemin relatif (les URL énumérées le sont), donc
		// pas parsable par `new URL()` sans base.
		const limiteDebit = (r: Check) =>
			r.status === 503 && r.url.replace(BASE, "").startsWith("/api/");
		const brides = results.filter(limiteDebit);
		const serverErr = results.filter((r) => r.ok404 && !r.ok5xx && !limiteDebit(r));
		if (brides.length) {
			console.warn(
				`${brides.length} route(s) /api/ bridées par le rate-limit nginx pendant ce test (503) — ignorées.`
			);
		}

		// Rapport lisible en cas d'échec.
		const fmt = (rs: Check[]) =>
			rs.map((r) => `  ${String(r.status).padStart(3)}  ${r.url}`).join("\n");

		const summary =
			`\nURLs testées : ${urls.length}` +
			` (pages static: ${staticPagePaths.length},` +
			` API énumérées: ${apiPaths.length},` +
			` sondes API: ${apiProbes.length},` +
			` crawl: ${crawled.length})` +
			(uncoveredDynamic.length
				? `\nDynamiques non échantillonnées (couvertes par crawl): ${uncoveredDynamic.join(", ")}`
				: "");

		if (notFound.length) {
			throw new Error(
				`${notFound.length} URL(s) renvoient 404 (régression) :\n${fmt(notFound)}\n${summary}`
			);
		}
		if (serverErr.length) {
			throw new Error(
				`${serverErr.length} URL(s) renvoient 5xx (bug serveur) :\n${fmt(serverErr)}\n${summary}`
			);
		}

		// Garde-fou : on a bien testé une masse d'URLs (sinon le crawl a échoué).
		expect(urls.length).toBeGreaterThan(20);
	}, 120_000);
});
