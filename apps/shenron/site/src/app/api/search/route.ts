/**
 * /api/search — recherche cross-entity du wiki pour la palette ⌘K (client).
 *
 * Server-only : appelle `dbUniverse.search()` (Drizzle/Neon, schéma `bot`) côté
 * serveur → le module `db-universe` (postgres-js) ne fuit jamais dans le bundle
 * client. La palette `CommandMenu` fetch cet endpoint en debounce.
 *
 * Même moteur que la page `/wiki/search` (ILIKE + proximité trigramme pg_trgm
 * + ranking exact > préfixe > similarité) → résultats tolérants aux fautes.
 */
import { dbUniverse, type SearchResults } from "@/lib/db-universe";
import { getLaunchConfig } from "@/lib/wiki-launch-config";
import { isPathPublic } from "@/lib/wiki-launch";
import { searchExternalSources, type ExternalSourceRecord } from "@/lib/external-source-catalog";
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GlobalSearchResults = SearchResults & { sources: ExternalSourceRecord[] };

const empty = (q: string): GlobalSearchResults => ({
	q,
	characters: [],
	planets: [],
	sagas: [],
	movies: [],
	games: [],
	episodes: [],
	techniques: [],
	races: [],
	transformations: [],
	arcs: [],
	mangaVolumes: [],
	mangaChapters: [],
	battles: [],
	locations: [],
	tournaments: [],
	voiceActors: [],
	soundtracks: [],
	powerLevels: [],
	items: [],
	dragons: [],
	databooks: [],
	novels: [],
	contributors: [],
	sources: [],
});

/**
 * Une catégorie de résultats n'est proposée que si sa route détail est
 * réellement publique. Le filtrage vit ICI, côté serveur, et non dans la
 * palette : celle-ci portait une liste en dur héritée de la bêta (4 catégories
 * sur 12), qui restait fausse dès qu'une rubrique était ouverte ou refermée
 * depuis /admin/lancement. Une URL témoin par catégorie suffit — `isPathPublic`
 * résout par préfixe, exactement comme le proxy.
 */
const TEMOINS: Record<Exclude<keyof SearchResults, "q">, string> = {
	characters: "/wiki/personnages/1",
	planets: "/wiki/lieux",
	sagas: "/wiki/sagas/x",
	movies: "/wiki/films/x",
	games: "/wiki/jeux/x",
	episodes: "/wiki/episodes/1",
	techniques: "/wiki/techniques/x",
	races: "/wiki/races/x",
	transformations: "/wiki/personnages/1",
	arcs: "/wiki/arcs/x",
	mangaVolumes: "/wiki/manga/volume/1",
	mangaChapters: "/wiki/manga/1",
	battles: "/wiki/combats",
	locations: "/wiki/lieux",
	tournaments: "/wiki/tournois",
	voiceActors: "/wiki/voix",
	soundtracks: "/wiki/musiques",
	powerLevels: "/wiki/puissances",
	items: "/wiki/objets",
	dragons: "/wiki/dragons",
	databooks: "/wiki/databooks",
	novels: "/wiki/romans",
	contributors: "/wiki/staff",
};

function filtrerSurAcces(r: SearchResults, cfg: Parameters<typeof isPathPublic>[1]): SearchResults {
	const out = empty(r.q);
	for (const [cle, temoin] of Object.entries(TEMOINS) as Array<
		[Exclude<keyof SearchResults, "q">, string]
	>) {
		if (isPathPublic(temoin, cfg)) {
			// @ts-expect-error — clé homogène des deux côtés, TS ne relie pas la paire.
			out[cle] = r[cle];
		}
	}
	return out;
}

export async function GET(req: NextRequest) {
	// Cap la longueur de `q` : une requête très longue multiplie inutilement le
	// coût pg_trgm (ILIKE + similarité trigramme) ; ~100 chars couvrent tout.
	const url = req.nextUrl ?? new URL(req.url);
	const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
	if (q.length < 2) return NextResponse.json(empty(q));
	const [results, cfg, external] = await Promise.all([
		dbUniverse.search(q).catch(() => null),
		getLaunchConfig(),
		searchExternalSources({ q, limit: 8 }),
	]);
	const wiki = filtrerSurAcces(results ?? empty(q), cfg);
	return NextResponse.json({ ...wiki, sources: external.records }, {
		headers: {
			"cache-control": "public, max-age=30, stale-while-revalidate=120",
		},
	});
}
