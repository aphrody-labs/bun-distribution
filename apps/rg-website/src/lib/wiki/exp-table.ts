import "server-only";

import "@/lib/azalee-runtime";

import { createPostgresClient } from "@rosegriffon/db/service";
import { buildExpTableData, type ExpLevelEntry, type ExpTableData } from "./exp-table-shared";

/**
 * Table d'expérience des joueurs — accès données (serveur uniquement).
 *
 * Source : table PostgreSQL `public.inagle_exp_table` (100 lignes, niveaux
 * 1→100, `need_exp` de 124 à 124072), lue via le client PostgreSQL partagé.
 *
 * Contrairement aux autres modules de `lib/wiki/`, celui-ci n'est PAS une façade
 * au-dessus de `@rosegriffon/azalee` : la bibliothèque n'expose aucun module
 * `wiki/exp-table`, la table n'avait jusqu'ici AUCUN consommateur dans le dépôt
 * (la projection est déclarée dans PostgreSQL). Toute la logique de
 * calcul vit dans le jumeau client-safe `exp-table-shared.ts`.
 *
 * Le schéma réel ne contient que deux colonnes (`level`, `need_exp`) : aucun
 * libellé, aucun multiplicateur de rareté, aucune courbe alternative. On n'expose
 * donc rien d'autre que ces deux colonnes et les calculs qui en dérivent.
 */

/** Ligne brute `inagle_exp_table` telle que stockée dans PostgreSQL. */
interface ExpTableRow {
	level: number | null;
	need_exp: number | null;
}

/**
 * Lit la table d'expérience complète et la normalise.
 *
 * En cas d'erreur de lecture, renvoie une table VIDE : la page affiche alors un
 * état vide honnête plutôt qu'une courbe fabriquée.
 */
export async function getExpTable(): Promise<ExpTableData> {
	const db = createPostgresClient();
	const { data, error } = await db.from("inagle_exp_table").select("level, need_exp");

	if (error || !data) {
		return buildExpTableData([]);
	}

	const entries: ExpLevelEntry[] = [];
	for (const row of data as ExpTableRow[]) {
		if (typeof row.level !== "number" || typeof row.need_exp !== "number") {
			continue;
		}
		entries.push({ level: row.level, needExp: row.need_exp });
	}

	return buildExpTableData(entries);
}
