// SPDX-License-Identifier: Apache-2.0
/**
 * Moteur de masquage canonique et protection du vocabulaire Dragon Ball.
 *
 * Implémente la doctrine stricte définie dans `dragon-ball-japonais/SKILL.md` :
 * 1. Détection des termes canoniques triés du plus long au plus court.
 * 2. Substitution par des marqueurs neutres latins (`Zeta001`, `Yuni002`...).
 * 3. Traduction par le modèle / agent.
 * 4. Réinjection des formes officielles françaises du wiki / canon.
 * 5. Contrôle qualité de conformité (anti-régression, seuil de japonais, absence de glose).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { intraduisible, refus } from "../databooks-traduction";
import { masquerTermes, PREFIXE_JETON, restaurerJetons } from "./traduction";

export interface LexiqueEntry {
	ja: string;
	fr: string;
	kind: "personnage" | "technique" | "planete" | "race" | "saga" | "arc" | "autre";
	length: number;
}

export interface MasquageResult {
	texteMasque: string;
	termesTrouves: Array<{
		token: string;
		ja: string;
		fr: string;
		kind: string;
	}>;
	tokenMap: Map<string, { ja: string; fr: string; kind: string }>;
}

let cachedLexique: LexiqueEntry[] | null = null;

/**
 * Charge le lexique canonique depuis data/lexique-db-canonique.json.
 */
export function chargerLexiqueCanonique(): LexiqueEntry[] {
	if (cachedLexique) return cachedLexique;

	// Chemins possibles selon le contexte d'exécution (site ou racine monorepo)
	const paths = [
		join(process.cwd(), "data", "shenron", "lexique-db-canonique.json"),
		join(process.cwd(), "data", "lexique-db-canonique.json"),
		join(process.cwd(), "..", "..", "..", "data", "shenron", "lexique-db-canonique.json"),
		join(process.cwd(), "..", "..", "..", "data", "lexique-db-canonique.json"),
		join(process.cwd(), "..", "..", "data", "shenron", "lexique-db-canonique.json"),
		join(process.cwd(), "..", "..", "data", "lexique-db-canonique.json"),
	];

	for (const p of paths) {
		if (existsSync(p)) {
			try {
				const content = readFileSync(p, "utf-8");
				const parsed = JSON.parse(content) as LexiqueEntry[];
				// Toujours s'assurer du tri par longueur décroissante
				cachedLexique = parsed.toSorted((a, b) => {
					if (b.length !== a.length) return b.length - a.length;
					return a.ja.localeCompare(b.ja);
				});
				return cachedLexique;
			} catch (e) {
				console.warn(`Impossible de lire le lexique depuis ${p}:`, e);
			}
		}
	}

	// Repli de sécurité minimal si le fichier n'est pas encore généré
	const fallback: LexiqueEntry[] = (
		[
			{ ja: "超サイヤ人ゴッド超サイヤ人", fr: "Super Saiyan Blue", kind: "race", length: 13 },
			{ ja: "超かめはめ波", fr: "Super Kamehameha", kind: "technique", length: 6 },
			{ ja: "ドラゴンボール", fr: "Dragon Ball", kind: "autre", length: 7 },
			{ ja: "超サイヤ人", fr: "Super Saiyan", kind: "race", length: 5 },
			{ ja: "かめはめ波", fr: "Kamehameha", kind: "technique", length: 5 },
			{ ja: "サイヤ人", fr: "Saiyan", kind: "race", length: 4 },
			{ ja: "ベジータ", fr: "Vegeta", kind: "personnage", length: 4 },
			{ ja: "ピッコロ", fr: "Piccolo", kind: "personnage", length: 4 },
			{ ja: "フリーザ", fr: "Freezer", kind: "personnage", length: 4 },
			{ ja: "魔人ブウ", fr: "Majin Boo", kind: "personnage", length: 4 },
			{ ja: "クリリン", fr: "Krilin", kind: "personnage", length: 4 },
			{ ja: "元気玉", fr: "Genkidama", kind: "technique", length: 3 },
			{ ja: "界王拳", fr: "Kaiô-ken", kind: "technique", length: 3 },
			{ ja: "孫悟空", fr: "Son Goku", kind: "personnage", length: 3 },
			{ ja: "セル", fr: "Cell", kind: "personnage", length: 2 },
		] as const as LexiqueEntry[]
	)
		.slice()
		.toSorted((a, b) => {
			if (b.length !== a.length) return b.length - a.length;
			return a.ja.localeCompare(b.ja);
		});

	cachedLexique = fallback;
	return fallback;
}

/**
 * Masque les entités Dragon Ball dans un texte japonais avec des tokens neutres.
 *
 * Règles (cf. `occurrencesDuLexique`) :
 * - le plus long d'abord, en une passe, sans chevauchement — indépendamment de
 *   l'ordre du lexique reçu ;
 * - aux frontières de mot pour le katakana : « セル » (Cell) ne mord plus dans
 *   « カプセルコーポレーション » (d'où les « Capsule Cell Corporation »).
 */
export function masquerVocabulaire(
	texteJa: string,
	options?: {
		lexique?: LexiqueEntry[];
		prefixeToken?: string;
	}
): MasquageResult {
	const lexique = options?.lexique ?? chargerLexiqueCanonique();
	const prefixe = options?.prefixeToken ?? PREFIXE_JETON;
	const { masque, jetons } = masquerTermes(texteJa, lexique, { prefixe });

	const tokenMap = new Map<string, { ja: string; fr: string; kind: string }>();
	const termesTrouves: MasquageResult["termesTrouves"] = [];
	for (const [token, entry] of jetons) {
		tokenMap.set(token, { ja: entry.ja, fr: entry.fr, kind: entry.kind });
		termesTrouves.push({ token, ja: entry.ja, fr: entry.fr, kind: entry.kind });
	}
	return { texteMasque: masque, termesTrouves, tokenMap };
}

/**
 * Démasque en rendant aussi les jetons non restaurés. Une planche dont
 * `residuels` n'est pas vide ne doit JAMAIS être déposée (« Zêta010 »).
 */
export function demasquerVocabulaireStrict(
	texteTraduit: string,
	tokenMap: Map<string, { ja: string; fr: string; kind: string }>,
	prefixe = PREFIXE_JETON
): { texte: string; residuels: string[] } {
	const table = new Map<string, string>();
	for (const [token, info] of tokenMap) table.set(token, info.fr);
	const { texte, residuels } = restaurerJetons(texteTraduit, table, prefixe);
	return { texte: texte.trim(), residuels };
}

/**
 * Démasque le texte traduit en réinjectant les termes officiels français.
 *
 * Tolère la casse, les accents et un séparateur (« Zêta010 », « ZETA 010 »).
 * Les jetons inconnus restent en clair : le juge de dépôt
 * (`jugerTraduction`, `_databooks-base.ts`) refuse alors la planche.
 */
export function demasquerVocabulaire(
	texteTraduit: string,
	tokenMap: Map<string, { ja: string; fr: string; kind: string }>
): string {
	return demasquerVocabulaireStrict(texteTraduit, tokenMap).texte;
}

/**
 * Vérifie l'éligibilité d'un texte japonais à être traduit.
 */
export function verifierTexteSource(texteJa: string): { traduisible: boolean; raison?: string } {
	const anomalie = intraduisible(texteJa);
	if (anomalie) {
		return { traduisible: false, raison: anomalie };
	}
	return { traduisible: true };
}

/**
 * Vérifie la qualité et conformité de la traduction finale française.
 */
export function verifierConformiteTraduction(
	texteFr: string,
	texteJa: string
): { valide: boolean; rejet?: string } {
	const defaut = refus(texteFr, texteJa);
	if (defaut) {
		return { valide: false, rejet: defaut };
	}
	return { valide: true };
}
