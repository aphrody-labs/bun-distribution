// SPDX-License-Identifier: Apache-2.0

/**
 * Zone de statistiques d'une fiche personnage — conversion texte ↔ jsonb.
 *
 * `bot.db_characters.stats` est un tableau libre `{label, value, accent}` : rien
 * n'impose « Ki », et une fiche peut aussi bien porter « Santé », « Portée » ou
 * « Groupe sanguin ». Cette liberté n'était accessible qu'au studio admin — un
 * contributeur ne pouvait ni ajouter une mesure, ni en corriger une, ni
 * remplacer un intitulé qui ne convenait pas.
 *
 * Le format d'échange est **une ligne par mesure**, `Intitulé : valeur` :
 *
 *     Ki : 8 000
 *     Santé : Excellente
 *     Vitesse de pointe : Mach 5
 *
 * Du texte, parce que c'est ce que le circuit de contribution sait relire,
 * comparer et afficher en diff. Demander du JSON à un contributeur, c'est
 * demander une syntaxe pour corriger une faute de frappe.
 *
 * Client-safe : la modale de contribution s'en sert pour valider avant envoi.
 */

export interface StatPersonnage {
	label: string;
	value: string;
	/** Accent de couleur, conservé tel quel quand la mesure existait déjà. */
	accent?: string | null;
}

/** Séparateurs acceptés entre l'intitulé et la valeur. */
const SEPARATEUR = /\s*[:：=]\s*/;

export const STATS_MAX = 12;
const STAT_LABEL_MAX = 40;
const STAT_VALUE_MAX = 60;

/**
 * Texte → mesures. Tolérant à dessein : les deux-points japonais, les tirets de
 * liste et les lignes vides ne doivent pas faire échouer une proposition
 * autrement valable.
 */
export function parseStats(texte: string): StatPersonnage[] {
	const out: StatPersonnage[] = [];
	for (const brute of texte.split(/\r?\n/)) {
		const ligne = brute.replace(/^\s*[-*•]\s*/, "").trim();
		if (!ligne) continue;
		const sep = SEPARATEUR.exec(ligne);
		if (!sep || sep.index === 0) continue;
		const label = ligne.slice(0, sep.index).trim().slice(0, STAT_LABEL_MAX);
		const value = ligne
			.slice(sep.index + sep[0].length)
			.trim()
			.slice(0, STAT_VALUE_MAX);
		if (!label || !value) continue;
		// Un même intitulé deux fois : la dernière écriture gagne, sans doublon
		// dans le rendu.
		const dejaLa = out.findIndex((s) => s.label.toLowerCase() === label.toLowerCase());
		if (dejaLa >= 0) out[dejaLa] = { ...out[dejaLa], value };
		else out.push({ label, value });
		if (out.length >= STATS_MAX) break;
	}
	return out;
}

/** Mesures → texte, dans l'ordre d'affichage. */
export function formatStats(stats: unknown): string {
	if (!Array.isArray(stats)) return "";
	return stats
		.map((s) => {
			const o = (s ?? {}) as Record<string, unknown>;
			const label = typeof o.label === "string" ? o.label.trim() : "";
			const value = typeof o.value === "string" ? o.value.trim() : "";
			return label && value ? `${label} : ${value}` : null;
		})
		.filter((l): l is string => l !== null)
		.join("\n");
}

/**
 * Fusionne une proposition avec l'existant pour **préserver les accents** : le
 * contributeur écrit du texte, il n'a pas à connaître le code couleur d'une
 * mesure, et une correction de valeur ne doit pas repeindre la fiche.
 */
export function fusionnerStats(propose: StatPersonnage[], actuel: unknown): StatPersonnage[] {
	const accents = new Map<string, string>();
	if (Array.isArray(actuel)) {
		for (const s of actuel) {
			const o = (s ?? {}) as Record<string, unknown>;
			if (typeof o.label === "string" && typeof o.accent === "string") {
				accents.set(o.label.toLowerCase(), o.accent);
			}
		}
	}
	return propose.map((s) => {
		const accent = accents.get(s.label.toLowerCase());
		return accent ? { ...s, accent } : s;
	});
}

/** Cette cible désigne-t-elle la zone de statistiques d'un personnage ? */
export function estCibleStats(table: string, column: string): boolean {
	return table === "db_characters" && column === "stats";
}
