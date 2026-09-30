#!/usr/bin/env bun
/**
 * `anilist_id` des films, dérivé du `mal_id` que la base porte déjà.
 *
 * POURQUOI C'EST SÛR
 * ------------------
 * Les 26 films ont tous un `mal_id`, et celui-là est un VRAI identifiant
 * MyAnimeList (contrairement à `db_episodes.mal_id`, qui n'est qu'une copie du
 * numéro d'épisode — mesuré sur les 564 lignes remplies, sans exception). Or
 * AniList indexe ses œuvres par `idMal` : le rapprochement ne repose donc sur
 * aucun appariement de titre, aucune heuristique, aucune approximation. Les 26
 * tiennent en une seule requête GraphQL, par alias.
 *
 * Contrôlé le 2026-09-04 : Wikidata (via `P4086` → `P8729`, CC0) rend
 * exactement les mêmes 26 identifiants, y compris les trois où `id ≠ idMal`
 * (Résurrection F 25389→20778, Super Broly 36946→101302, Super Hero
 * 48903→133898). Deux sources indépendantes, zéro divergence.
 *
 * CE QUE CE SCRIPT NE TOUCHE PAS, VOLONTAIREMENT
 * ----------------------------------------------
 * AniList donne aussi durées et dates de sortie, et elles divergent de nos
 * valeurs sur cinq films — mais ce sont des ARBITRAGES ÉDITORIAUX, pas des
 * erreurs : *Path to Power* dure 74 ou 80 min selon le montage, le « Plan
 * d'anéantissement » porte 1993-08-06 ou 1993-07-23 selon qu'on date l'OAV ou
 * sa ressortie. Écraser ces champs ferait passer un choix pour une correction.
 * Seul `anilist_id` est écrit.
 *
 * SIMULATION PAR DÉFAUT. Une révision `public.wiki_revisions` par écriture.
 *
 * Usage :
 *   bun scripts/ingere-anilist-films.ts
 *   bun scripts/ingere-anilist-films.ts --appliquer
 */
import { join } from "node:path";
import postgres from "postgres";

const args = new Set(process.argv.slice(2));
const flag = (nom: string) => args.has(`--${nom}`);
const APPLIQUER = flag("appliquer");

async function urlBase(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	const texte = await Bun.file(join(import.meta.dir, "..", ".env"))
		.text()
		.catch(() => "");
	const lignes = texte.split("\n").filter((l) => l.startsWith("DATABASE_URL="));
	const valeur = lignes
		.at(-1)
		?.slice("DATABASE_URL=".length)
		.trim()
		.replace(/^["']|["']$/g, "");
	if (!valeur) {
		console.error("✗ DATABASE_URL introuvable.");
		process.exit(1);
	}
	return valeur;
}

/** curl plutôt que `fetch` : convention du projet, l'empreinte TLS de Bun se fait filtrer ailleurs. */
async function anilist(
	requete: string
): Promise<Record<string, { id: number; title?: { romaji?: string } } | null>> {
	const proc = Bun.spawn(
		[
			"curl",
			"-sS",
			"-m",
			"40",
			"-X",
			"POST",
			"https://graphql.anilist.co",
			"-H",
			"Content-Type: application/json",
			"-d",
			JSON.stringify({ query: requete }),
		],
		{ stdout: "pipe", stderr: "ignore" }
	);
	const texte = await new Response(proc.stdout).text();
	await proc.exited;
	const j = JSON.parse(texte) as {
		data?: Record<string, { id: number; title?: { romaji?: string } } | null>;
		errors?: unknown;
	};
	if (!j.data) throw new Error(`réponse AniList inexploitable : ${texte.slice(0, 200)}`);
	return j.data;
}

const idRevision = () =>
	Array.from(
		{ length: 24 },
		() => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
	).join("");

const sql = postgres(await urlBase(), { max: 2, prepare: false });
try {
	const films = await sql<
		{ id: string; title: string; mal_id: string | null; anilist_id: string | null }[]
	>`
		SELECT id, title, mal_id, anilist_id FROM bot.db_movies
		WHERE mal_id IS NOT NULL ORDER BY id`;
	console.log(`${films.length} film(s) portant un mal_id.\n`);

	// Une seule requête : un alias par film, la clé porte l'id de notre ligne.
	const corps = films
		.map((f) => `f${f.id}: Media(idMal: ${Number(f.mal_id)}, type: ANIME) { id title { romaji } }`)
		.join("\n");
	const data = await anilist(`{ ${corps} }`);

	let poses = 0;
	let inchanges = 0;
	for (const f of films) {
		const trouve = data[`f${f.id}`];
		if (!trouve) {
			console.log(`  ⊘ ${f.title} (mal ${f.mal_id}) — inconnu d'AniList`);
			continue;
		}
		const avant = f.anilist_id ? Number(f.anilist_id) : null;
		if (avant === trouve.id) {
			inchanges++;
			continue;
		}

		console.log(
			`  ${String(trouve.id).padStart(7)} ← mal ${String(f.mal_id).padStart(6)} · ${f.title.slice(0, 44).padEnd(44)} (${trouve.title?.romaji ?? "?"})`
		);
		poses++;
		if (!APPLIQUER) continue;

		await sql.begin(async (tx) => {
			await tx`UPDATE bot.db_movies SET anilist_id = ${trouve.id} WHERE id = ${Number(f.id)}`;
			await tx`INSERT INTO public.wiki_revisions ${tx({
				id: idRevision(),
				tableName: "db_movies",
				rowId: String(f.id),
				action: "update",
				label: f.title,
				before: tx.json({ anilist_id: avant }),
				after: tx.json({ anilist_id: trouve.id }),
				editorId: "agent",
				editorName: "Script ingere-anilist-films (AniList par idMal)",
			})}`;
		});
	}

	console.log(
		APPLIQUER
			? `\n✔ ${poses} identifiant(s) posé(s), ${inchanges} déjà à jour. Le tout versionné.`
			: `\n${poses} identifiant(s) à poser, ${inchanges} déjà à jour.\n(simulation — relancer avec --appliquer)`
	);
} catch (e) {
	console.error("✗", e instanceof Error ? e.message : e);
	process.exitCode = 1;
} finally {
	await sql.end();
}
