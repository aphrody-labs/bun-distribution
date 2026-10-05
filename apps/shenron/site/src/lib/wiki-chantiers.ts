/**
 * wiki-chantiers — ce qu'il reste à écrire dans le wiki, en clair et en public.
 *
 * Un wiki communautaire ne se remplit pas parce qu'on invite à contribuer : il
 * se remplit parce qu'on montre **où** il manque quelque chose. Ce module
 * compte, par rubrique, les fiches visibles dont ni l'article ni la description
 * ne disent rien, et en tire une poignée d'exemples cliquables — le lecteur
 * arrive alors sur une fiche vide avec le bouton de contribution sous le titre.
 *
 * Les comptes sont **mesurés**, jamais écrits en dur : ils bougent à chaque
 * contribution acceptée, et un chiffre figé dans le code serait faux le jour même.
 *
 * SQL brut plutôt que Drizzle : les six tables n'ont ni la même clé publique
 * (id ou slug) ni les mêmes colonnes, et les typer une par une coûtait plus de
 * casts que de lisibilité. Les noms de tables sont des littéraux du fichier —
 * aucune entrée utilisateur n'entre dans la requête.
 *
 * Server-only.
 */
import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { formatCharacterSlug, formatPlanetSlug } from "@/lib/wiki-slugs";

export interface Chantier {
	table: string;
	/** Libellé de la rubrique (« Personnages », « Techniques »…). */
	rubrique: string;
	/** Fiches visibles sans article NI description. */
	vides: number;
	/** Fiches visibles au total. */
	total: number;
	exemples: { label: string; href: string }[];
}

interface Cible {
	table: string;
	rubrique: string;
	/** Colonne qui construit l'URL publique. */
	cle: "id" | "slug";
	prefixe: string;
}

const CIBLES: Cible[] = [
	{ table: "db_characters", rubrique: "Personnages", cle: "id", prefixe: "/wiki/personnages" },
	{ table: "db_planets", rubrique: "Cosmologie", cle: "id", prefixe: "/wiki/cosmologie" },
	{ table: "db_techniques", rubrique: "Techniques", cle: "slug", prefixe: "/wiki/techniques" },
	{ table: "db_races", rubrique: "Races", cle: "slug", prefixe: "/wiki/races" },
	{ table: "db_sagas", rubrique: "Sagas", cle: "slug", prefixe: "/wiki/sagas" },
	{ table: "db_arcs", rubrique: "Arcs", cle: "slug", prefixe: "/wiki/arcs" },
];

export async function listeChantiers(exemplesParRubrique = 6): Promise<Chantier[]> {
	const resultats = await Promise.all(
		CIBLES.map(async (c): Promise<Chantier | null> => {
			// Les six tables portent toutes `visible` (migration de visibilité du
			// 2026-07-05) — vérifié en base, pas supposé.
			const filtreVisible = sql.raw("coalesce(visible, true)");
			const nomTable = sql.raw(`bot.${c.table}`);
			const cle = sql.raw(c.cle);
			const vide = sql.raw(`coalesce(article, '') = '' and coalesce(description, '') = ''`);

			try {
				const [totaux, exemples] = await Promise.all([
					db.execute<{ vides: string; total: string }>(sql`
						select
							count(*) filter (where ${vide}) as vides,
							count(*) as total
						from ${nomTable}
						where ${filtreVisible}`),
					db.execute<{ cle: string; name: string }>(sql`
						select ${cle} as cle, name
						from ${nomTable}
						where ${filtreVisible} and ${vide} and coalesce(name, '') <> ''
						order by name
						limit ${exemplesParRubrique}`),
				]);

				const t = totaux[0];
				// postgres-js rend les entiers de `count()` en CHAÎNES : sans Number(),
				// le tri « le plus vide d'abord » comparerait "9" et "112".
				const vides = Number(t?.vides ?? 0);
				return {
					table: c.table,
					rubrique: c.rubrique,
					vides,
					total: Number(t?.total ?? 0),
					exemples: exemples.map((r) => {
						const slug =
							c.table === "db_characters"
								? formatCharacterSlug({ id: Number(r.cle), name: r.name })
								: c.table === "db_planets"
									? formatPlanetSlug({ id: Number(r.cle), name: r.name })
									: encodeURIComponent(String(r.cle));
						return {
							label: r.name,
							href: `${c.prefixe}/${slug}`,
						};
					}),
				};
			} catch (err) {
				// Une rubrique qui échoue ne doit pas emporter la page entière.
				console.error(`[chantiers] ${c.table}`, err);
				return null;
			}
		})
	);

	return resultats
		.filter((r): r is Chantier => r !== null && r.vides > 0)
		.toSorted((a, b) => b.vides - a.vides);
}
