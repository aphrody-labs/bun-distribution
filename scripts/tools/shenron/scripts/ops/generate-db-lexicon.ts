// SPDX-License-Identifier: Apache-2.0
/**
 * Extrait et consolide le lexique canonique Dragon Ball depuis la base PostgreSQL,
 * les fichiers de techniques et les références du corpus.
 *
 * Sortie : `data/lexique-db-canonique.json`
 *
 * Utilisation :
 *   bun scripts/ops/generate-db-lexicon.ts
 */

import { join } from "node:path";
import { connecte } from "../../../../../apps/shenron/site/scripts/_databooks-base";
import { TECHNIQUES } from "../../../../../apps/shenron/site/scripts/_technique-lexicon";
import { contientJaponais } from "../../../../../apps/shenron/site/src/lib/ja/normalisation";

export interface LexiqueEntry {
	ja: string;
	fr: string;
	kind: "personnage" | "technique" | "planete" | "race" | "saga" | "arc" | "autre";
	length: number;
}

// Termes vérifiés manuellement prioritaires depuis references/lexique.md
const LEXIQUE_CANON_BASE: Array<{ ja: string; fr: string; kind: LexiqueEntry["kind"] }> = [
	{ ja: "ドラゴンボール", fr: "Dragon Ball", kind: "autre" },
	{ ja: "孫悟空", fr: "Son Goku", kind: "personnage" },
	{ ja: "カカロット", fr: "Kakarot", kind: "personnage" },
	{ ja: "ベジータ", fr: "Vegeta", kind: "personnage" },
	{ ja: "ピッコロ", fr: "Piccolo", kind: "personnage" },
	{ ja: "フリーザ", fr: "Freezer", kind: "personnage" },
	{ ja: "セル", fr: "Cell", kind: "personnage" },
	{ ja: "魔人ブウ", fr: "Majin Boo", kind: "personnage" },
	{ ja: "トランクス", fr: "Trunks", kind: "personnage" },
	{ ja: "ブルマ", fr: "Bulma", kind: "personnage" },
	{ ja: "クリリン", fr: "Krilin", kind: "personnage" },
	{ ja: "孫悟飯", fr: "Son Gohan", kind: "personnage" },
	{ ja: "天津飯", fr: "Tenshinhan", kind: "personnage" },
	{ ja: "ヤムチャ", fr: "Yamcha", kind: "personnage" },
	{ ja: "界王拳", fr: "Kaiô-ken", kind: "technique" },
	{ ja: "超サイヤ人", fr: "Super Saiyan", kind: "race" },
	{ ja: "超サイヤ人ゴッド", fr: "Super Saiyan God", kind: "race" },
	{ ja: "超サイヤ人ゴッド超サイヤ人", fr: "Super Saiyan Blue", kind: "race" },
	{ ja: "超サイヤ人ブルー", fr: "Super Saiyan Blue", kind: "race" },
	{ ja: "身勝手の極意", fr: "Ultra Instinct", kind: "technique" },
	{ ja: "我儘の極意", fr: "Ultra Ego", kind: "technique" },
	{ ja: "サイヤ人", fr: "Saiyan", kind: "race" },
	{ ja: "ナメック星人", fr: "Namek", kind: "race" },
	{ ja: "ナメック星", fr: "Planète Namek", kind: "planete" },
	{ ja: "人造人間", fr: "Cyborg", kind: "race" },
	{ ja: "界王様", fr: "Maître Kaïo", kind: "personnage" },
	{ ja: "界王神", fr: "Kaïo Shin", kind: "personnage" },
	{ ja: "大界王", fr: "Grand Kaïo", kind: "personnage" },
	{ ja: "ギニュー特戦隊", fr: "Commando Ginyu", kind: "personnage" },
	{ ja: "亀仙人", fr: "Tortue Géniale", kind: "personnage" },
	{ ja: "武天老師", fr: "Maître Roshi", kind: "personnage" },
	{ ja: "神龍", fr: "Shenron", kind: "personnage" },
	{ ja: "ポルンガ", fr: "Polunga", kind: "personnage" },
	{ ja: "カリン様", fr: "Maître Karin", kind: "personnage" },
	{ ja: "ヤジロベー", fr: "Yajirobé", kind: "personnage" },
	{ ja: "天下一武道会", fr: "Tenkaichi Budokai", kind: "autre" },
	{ ja: "精神と時の部屋", fr: "Salle de l'Esprit et du Temps", kind: "autre" },
	{ ja: "筋斗雲", fr: "Kinto-Un", kind: "autre" },
	{ ja: "如意棒", fr: "Nyoï-bô", kind: "autre" },
	{ ja: "仙豆", fr: "Senzu", kind: "autre" },
	{ ja: "ホイポイカプセル", fr: "Capsule Hoi-Poi", kind: "autre" },
	{ ja: "ドラゴンレーダー", fr: "Dragon Radar", kind: "autre" },
	{ ja: "スカウター", fr: "Scouter", kind: "autre" },
	{ ja: "ポタラ", fr: "Potalas", kind: "autre" },
];

async function main() {
	console.log("=== Extraction du Lexique Canonique Dragon Ball ===");

	const mapCanon = new Map<string, LexiqueEntry>();

	// 1. Ajouter le socle de base
	for (const e of LEXIQUE_CANON_BASE) {
		const ja = e.ja.trim();
		mapCanon.set(ja, {
			ja,
			fr: e.fr.trim(),
			kind: e.kind,
			length: ja.length,
		});
	}

	// 2. Ajouter les techniques canoniques de _technique-lexicon.ts
	for (const t of TECHNIQUES) {
		const ja = t.ja.trim();
		if (ja.length >= 2 && contientJaponais(ja)) {
			mapCanon.set(ja, {
				ja,
				fr: t.name.trim(),
				kind: "technique",
				length: ja.length,
			});
		}
	}

	// 3. Interroger PostgreSQL
	const sql = await connecte();
	try {
		const rawRows = await sql<{ ja: string; fr: string; kind: string }[]>`
			SELECT name_ja AS ja, name AS fr, 'personnage' AS kind FROM bot.db_characters WHERE name_ja IS NOT NULL AND trim(name_ja) <> ''
			UNION ALL SELECT name_ja, name, 'planete'   FROM bot.db_planets    WHERE name_ja IS NOT NULL AND trim(name_ja) <> ''
			UNION ALL SELECT name_ja, name, 'race'      FROM bot.db_races      WHERE name_ja IS NOT NULL AND trim(name_ja) <> ''
			UNION ALL SELECT name_ja, name, 'saga'      FROM bot.db_sagas      WHERE name_ja IS NOT NULL AND trim(name_ja) <> ''
			UNION ALL SELECT name_ja, name, 'arc'       FROM bot.db_arcs       WHERE name_ja IS NOT NULL AND trim(name_ja) <> ''
			UNION ALL SELECT name_ja, name, 'technique' FROM bot.db_techniques WHERE name_ja IS NOT NULL AND trim(name_ja) <> ''
		`;

		console.log(`Données brutes extraites de PostgreSQL : ${rawRows.length} lignes`);

		for (const r of rawRows) {
			const fr = (r.fr ?? "").trim();
			if (!fr) continue;

			// Découper les variantes japonaises (souvent séparées par virgules ou parenthèses)
			const variantes = String(r.ja).split(/[,、;\n/]/);
			for (const v of variantes) {
				// Nettoyer le texte : extraire uniquement la portion en caractères japonais
				// (kanji, hiragana, katakana, prolongateur ー, points médians)
				const fragmentsJa = v.match(/[぀-ヿ一-鿿ー・･·]+/g);
				if (!fragmentsJa) continue;

				for (const frag of fragmentsJa) {
					let ja = frag.trim();
					// Élaguer les particules grammaticales orphelines en début ou fin de fragment isolé
					ja = ja.replace(/^[のはがをにへでと]+/, "").replace(/[のはがをにへでと]+$/, "").trim();

					// Exclure les fragments isolés de moins de 2 caractères (sauf s'ils sont explicites)
					if (ja.length < 2 || !contientJaponais(ja)) continue;

					// Exclure les mots du dictionnaire général qui polluent le masquage
					const MOTS_GENERAIRES = new Set([
						"宇宙", "惑星", "純粋", "未来", "過去", "現在", "悪", "善", "神", "王", "界",
						"星", "武道", "大会", "文化", "社会", "生命", "能力", "目的", "事件", "原因",
						"修行", "歴史", "地球", "人間", "子供", "戦士", "仲間", "敵", "力", "心", "体"
					]);
					if (MOTS_GENERAIRES.has(ja)) continue;

					// Ne pas écraser une entrée prioritaire
					if (!mapCanon.has(ja)) {
						mapCanon.set(ja, {
							ja,
							fr,
							kind: r.kind as LexiqueEntry["kind"],
							length: ja.length,
						});
					}
				}
			}
		}
	} finally {
		await sql.end();
	}

	// 4. Trier le lexique par longueur japonaise DÉCROISSANTE (règle primordiale)
	const lexiqueTrie = Array.from(mapCanon.values()).toSorted((a, b) => {
		if (b.length !== a.length) return b.length - a.length;
		return a.ja.localeCompare(b.ja);
	});

	console.log(`Total entrées uniques du lexique canonique : ${lexiqueTrie.length}`);

	// 5. Sauvegarder dans data/lexique-db-canonique.json
	const outPath = join(process.cwd(), "data", "lexique-db-canonique.json");
	await Bun.write(outPath, JSON.stringify(lexiqueTrie, null, 2));
	console.log(`Lexique écrit avec succès dans : ${outPath}`);
}

main().catch((err) => {
	console.error("Erreur lors de la génération du lexique :", err);
	process.exit(1);
});
