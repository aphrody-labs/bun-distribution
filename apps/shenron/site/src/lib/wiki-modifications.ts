/**
 * wiki-modifications — le flux public des changements du wiki.
 *
 * L'historique existait déjà (`wiki_revisions`) mais restait derrière
 * `/admin/wiki/history`. Sur un wiki communautaire c'est un contresens : le
 * crédit d'une contribution n'existe vraiment que s'il est visible, et un
 * lecteur qui voit le wiki bouger toutes les heures y revient. Ce module
 * transforme les révisions en flux lisible côté public.
 *
 * Deux difficultés que le back-office n'avait pas :
 *
 *  1. **L'URL publique n'est pas dans la révision.** Le snapshot `after` est
 *     réduit aux colonnes réellement écrites — un dépôt qui ne touche que
 *     `article` ne contient pas le `slug`. On résout donc les URL par lot, une
 *     requête par table, jamais une par ligne.
 *  2. **Tout n'est pas montrable.** Les bascules de visibilité et les
 *     changements sur des tables sans page publique ne disent rien à un
 *     lecteur ; les afficher ferait du bruit et fuiterait des fiches masquées.
 *
 * Server-only.
 */
import "server-only";
import { desc, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { wikiRevisions } from "@/db/schema";
import { CONTRIBUTABLE_COLUMNS } from "@/lib/contributions-shared";

/** Tables ayant une page publique, avec de quoi en construire l'URL. */
const RUBRIQUES: Record<string, { rubrique: string; prefixe: string; cle: "id" | "slug" }> = {
	db_characters: { rubrique: "Personnage", prefixe: "/wiki/personnages", cle: "id" },
	db_planets: { rubrique: "Lieu", prefixe: "/wiki/cosmologie", cle: "id" },
	db_techniques: { rubrique: "Technique", prefixe: "/wiki/techniques", cle: "slug" },
	db_races: { rubrique: "Race", prefixe: "/wiki/races", cle: "slug" },
	db_sagas: { rubrique: "Saga", prefixe: "/wiki/sagas", cle: "slug" },
	db_arcs: { rubrique: "Arc", prefixe: "/wiki/arcs", cle: "slug" },
	db_movies: { rubrique: "Film", prefixe: "/wiki/films", cle: "slug" },
	db_games: { rubrique: "Jeu", prefixe: "/wiki/jeux", cle: "slug" },
	db_databooks: { rubrique: "Databook", prefixe: "/wiki/databooks", cle: "id" },
	db_episodes: { rubrique: "Épisode", prefixe: "/wiki/episodes", cle: "id" },
};

export interface Modification {
	id: string;
	/** `<table>:<ligne>` — sert au regroupement des retouches successives. */
	cle: string;
	rubrique: string;
	label: string;
	href: string | null;
	/** Ce qui a changé, en clair (« Article », « Description »…). */
	champs: string[];
	auteur: string | null;
	createdAt: string;
}

/** Libellé humain d'une colonne ; `null` pour ce qu'on ne montre pas. */
function libelleChamp(col: string): string | null {
	if (col in CONTRIBUTABLE_COLUMNS) return CONTRIBUTABLE_COLUMNS[col]!.label;
	if (col === "articleSources") return null; // conséquence d'une écriture, pas un fait
	if (col === "visible") return null;
	if (col === "image" || col === "cover" || col === "poster") return "Illustration";
	if (col === "name" || col === "title") return "Nom";
	return null;
}

/**
 * Résout l'URL publique de chaque ligne citée, par lot : une requête par table
 * concernée. Sur une page de 50 modifications touchant 6 tables, c'est 6
 * requêtes au lieu de 50.
 */
async function resoudreUrls(parTable: Map<string, Set<string>>): Promise<Map<string, string>> {
	const urls = new Map<string, string>();
	await Promise.all(
		[...parTable.entries()].map(async ([table, ids]) => {
			const conf = RUBRIQUES[table];
			if (!conf || ids.size === 0) return;
			const nomTable = sql.raw(`bot.${table}`);
			const cle = sql.raw(conf.cle);
			// `= any(${array})` ne marche pas ici : postgres-js type le paramètre
			// d'après le cast et envoie le tableau comme scalaire (« malformed array
			// literal »). On développe donc la liste en paramètres individuels.
			const liste = sql.join(
				[...ids].map((i) => sql`${i}`),
				sql`, `
			);
			try {
				const lignes = await db.execute<{ id: string; cle: string; visible: boolean | null }>(sql`
					select id::text as id, ${cle}::text as cle, visible
					from ${nomTable}
					where id::text in (${liste})`);
				for (const l of lignes) {
					// Une fiche masquée renvoie 404 en lecture publique : la citer dans le
					// flux enverrait le lecteur dans le mur.
					if (l.visible === false || !l.cle) continue;
					urls.set(`${table}:${l.id}`, `${conf.prefixe}/${encodeURIComponent(l.cle)}`);
				}
			} catch (err) {
				console.error(`[modifications] urls ${table}`, err);
			}
		})
	);
	return urls;
}

export async function listeModifications(limite = 60): Promise<Modification[]> {
	const brutes = await db
		.select()
		.from(wikiRevisions)
		.where(inArray(wikiRevisions.tableName, Object.keys(RUBRIQUES)))
		.orderBy(desc(wikiRevisions.createdAt))
		// On tire large : le filtrage « rien de montrable » se fait ensuite, en
		// mémoire, et mangerait la page si on demandait pile `limite` lignes.
		.limit(limite * 4);

	const parTable = new Map<string, Set<string>>();
	for (const r of brutes) {
		if (r.rowId === "*") continue;
		const s = parTable.get(r.tableName) ?? new Set<string>();
		s.add(r.rowId);
		parTable.set(r.tableName, s);
	}
	const urls = await resoudreUrls(parTable);

	const sorties: Modification[] = [];
	for (const r of brutes) {
		if (sorties.length >= limite) break;
		if (r.action === "visibility" || r.action === "visibility-all") continue;
		const conf = RUBRIQUES[r.tableName];
		if (!conf) continue;

		const after = (r.after ?? {}) as Record<string, unknown>;
		const champs = [
			...new Set(
				Object.keys(after)
					.map(libelleChamp)
					.filter((v): v is string => v !== null)
			),
		];
		// Une révision dont rien n'est montrable (visibilité seule, sources) n'a
		// pas sa place dans un flux destiné à des lecteurs.
		if (champs.length === 0) continue;

		// Regroupe les retouches successives d'une même fiche par une même
		// personne : enregistrer un formulaire produit souvent deux révisions à la
		// seconde près, et les lister deux fois donne l'impression d'un flux
		// gonflé. On fusionne alors la liste des champs touchés.
		const precedente = sorties[sorties.length - 1];
		if (
			precedente &&
			precedente.cle === `${r.tableName}:${r.rowId}` &&
			precedente.auteur === r.editorName
		) {
			precedente.champs = [...new Set([...precedente.champs, ...champs])];
			continue;
		}

		sorties.push({
			id: r.id,
			cle: `${r.tableName}:${r.rowId}`,
			rubrique: conf.rubrique,
			label: r.label ?? `${conf.rubrique} #${r.rowId}`,
			href: urls.get(`${r.tableName}:${r.rowId}`) ?? null,
			champs,
			auteur: r.editorName,
			createdAt: r.createdAt.toISOString(),
		});
	}
	return sorties;
}
