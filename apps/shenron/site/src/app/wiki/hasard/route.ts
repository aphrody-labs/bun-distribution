import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getLaunchConfig } from "@/lib/wiki-launch-config";
import { isPathPublic } from "@/lib/wiki-launch";

/**
 * `/wiki/hasard` — envoie sur une fiche du wiki tirée au sort.
 *
 * Route handler et non page : la réponse est une redirection, il n'y a rien à
 * rendre. `force-dynamic` parce que le tirage doit être neuf à chaque appel —
 * une page mise en cache renverrait éternellement la même « surprise ».
 *
 * Le tirage ne pioche QUE dans les rubriques ouvertes au public et parmi les
 * entités visibles : sans ces deux filtres, le bouton « au hasard » enverrait
 * régulièrement sur /wiki-bientot, ce qui est l'inverse de l'effet recherché.
 */
/**
 * Redirection **relative**. Derrière nginx, `request.url` d'un route handler
 * porte l'origine interne du socket (`http://localhost:3010`) et NON le `Host`
 * public : `NextResponse.redirect(new URL(path, request.url))` renvoyait donc un
 * `Location: https://localhost:3010/wiki/...` — lien mort pour le visiteur, et
 * requête RSC bloquée par CORS quand la navigation vient du routeur client (le
 * bouton « au hasard » ne faisait alors visiblement RIEN). Un `Location`
 * relatif est valide (RFC 7231 §7.1.2) et résolu par le client sur l'origine
 * qu'il a réellement demandée — donc juste quel que soit le proxy en amont.
 */
function seeOther(path: string): Response {
	return new Response(null, {
		status: 302,
		// Jamais de cache sur une redirection aléatoire.
		headers: { location: path, "cache-control": "no-store" },
	});
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Une source = une table, la façon d'en tirer une ligne, et l'URL produite. */
const SOURCES: Array<{
	/** Chemin témoin, pour tester l'ouverture de la rubrique. */
	probe: string;
	query: string;
	href: (row: Record<string, unknown>) => string;
}> = [
	{
		probe: "/wiki/episodes/1",
		query: `SELECT id FROM bot.db_episodes WHERE visible ORDER BY random() LIMIT 1`,
		href: (r) => `/wiki/episodes/${r.id}`,
	},
	{
		probe: "/wiki/films/x",
		query: `SELECT slug FROM bot.db_movies WHERE visible AND slug IS NOT NULL ORDER BY random() LIMIT 1`,
		href: (r) => `/wiki/films/${r.slug}`,
	},
	{
		probe: "/wiki/sagas/x",
		query: `SELECT slug FROM bot.db_sagas WHERE visible AND slug IS NOT NULL ORDER BY random() LIMIT 1`,
		href: (r) => `/wiki/sagas/${r.slug}`,
	},
	{
		probe: "/wiki/arcs/x",
		query: `SELECT slug FROM bot.db_arcs WHERE visible AND slug IS NOT NULL ORDER BY random() LIMIT 1`,
		href: (r) => `/wiki/arcs/${r.slug}`,
	},
	{
		probe: "/wiki/techniques/x",
		query: `SELECT slug FROM bot.db_techniques WHERE visible AND slug IS NOT NULL ORDER BY random() LIMIT 1`,
		href: (r) => `/wiki/techniques/${r.slug}`,
	},
	{
		probe: "/wiki/personnages/1",
		query: `SELECT id FROM bot.db_characters WHERE visible ORDER BY random() LIMIT 1`,
		href: (r) => `/wiki/personnages/${r.id}`,
	},
	{
		probe: "/wiki/jeux/x",
		query: `SELECT slug FROM bot.db_games WHERE visible AND slug IS NOT NULL ORDER BY random() LIMIT 1`,
		href: (r) => `/wiki/jeux/${r.slug}`,
	},
];

export async function GET() {
	const home = "/wiki/episodes";
	try {
		const cfg = await getLaunchConfig();
		const open = SOURCES.filter((s) => isPathPublic(s.probe, cfg));
		if (open.length === 0) return seeOther(home);

		// Tirage de la table d'abord, puis de la ligne : `ORDER BY random()` sur une
		// UNION de toutes les tables coûterait un balayage complet de chacune.
		// Deux tentatives suffisent à couvrir le cas d'une table ouverte mais vide.
		for (let attempt = 0; attempt < 2; attempt++) {
			const src = open[Math.floor(Math.random() * open.length)]!;
			const rows = (await db.execute(sql.raw(src.query))) as unknown as Array<
				Record<string, unknown>
			>;
			const row = Array.isArray(rows) ? rows[0] : undefined;
			if (row) return seeOther(src.href(row));
		}
		return seeOther(home);
	} catch (err) {
		console.error("[wiki/hasard]", err);
		return seeOther(home);
	}
}
