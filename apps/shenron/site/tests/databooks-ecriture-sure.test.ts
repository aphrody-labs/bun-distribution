// SPDX-License-Identifier: Apache-2.0
/**
 * Écriture sûre des planches de databooks : protection du lexique, juge unique
 * de dépôt, écriture atomique par planche.
 *
 * Les cas reproduits sont ceux relevés en base le 2026-09-14 :
 *   - « Capsule Cell Corporation » (`shenron-vps-agent`) : « セル » masqué dans
 *     « カプセルコーポレーション » ;
 *   - « sur Terre Terre » (`shenron-vps-agent`) : terme traduit ET jeton recopié ;
 *   - « **Zêta010** » (`shenron-massive-vps`, 567 planches) : jeton accentué par
 *     le moteur, jamais restauré ;
 *   - « 的 あ 无 » → « cible Ah Non » : du bruit OCR traduit mot à mot ;
 *   - `tesseract-5-fra` : `text_fr` identique à `text`.
 */
import { afterAll, describe, expect, test } from "bun:test";
import type postgres from "postgres";
import {
	bruitOcr,
	connecte,
	deposerTraduction,
	deposerTranscription,
	ecrirePlanche,
	jetonsFuyants,
	jugerTraduction,
	motsDoublesAjoutes,
} from "../scripts/_databooks-base";
import {
	demasquerVocabulaire,
	demasquerVocabulaireStrict,
	masquerVocabulaire,
	type LexiqueEntry,
} from "../src/lib/ja/lexique-canonique";
import {
	bordsDeMot,
	jetonsResiduels,
	occurrencesDuLexique,
	protegerTermes,
	restaurerJetons,
} from "../src/lib/ja/traduction";

const LEX: LexiqueEntry[] = [
	// Ordre volontairement défavorable : le court AVANT le long.
	{ ja: "セル", fr: "Cell", kind: "personnage", length: 2 },
	{ ja: "地球", fr: "Terre", kind: "planete", length: 2 },
	{ ja: "天津飯", fr: "Tenshinhan", kind: "personnage", length: 3 },
	{ ja: "悟空", fr: "Goku", kind: "personnage", length: 2 },
	{ ja: "孫悟空", fr: "Son Goku", kind: "personnage", length: 3 },
	{ ja: "サイヤ", fr: "Saiya", kind: "autre", length: 3 },
	{ ja: "サイヤ人", fr: "Saiyan", kind: "race", length: 4 },
];

describe("protection du lexique — cas « Capsule Cell Corporation »", () => {
	test("« セル » n'est pas masqué à l'intérieur de « カプセルコーポレーション »", () => {
		const { texteMasque, tokenMap } = masquerVocabulaire(
			"地球上の乗り物のなんと48%がカプセルコーポレーションの製品",
			{ lexique: LEX }
		);
		expect(texteMasque).toContain("カプセルコーポレーション");
		expect([...tokenMap.values()].map((t) => t.fr)).not.toContain("Cell");
	});

	test("« セル » isolé reste masqué, y compris collé à des kana grammaticaux ou des kanji", () => {
		const { texteMasque, tokenMap } = masquerVocabulaire("セルは強い。セル編と、カプセル", { lexique: LEX });
		expect([...tokenMap.values()].map((t) => t.fr)).toEqual(["Cell"]);
		expect(texteMasque).toBe("Zeta001は強い。Zeta001編と、カプセル");
	});

	test("même protection dans `protegerTermes` (traduction-boucle, ja-traduire)", () => {
		const { masque, table } = protegerTermes("カプセルコーポレーションのセル", [
			{ ja: "セル", fr: "Cell", kind: "personnage" },
		]);
		expect(masque).toBe("カプセルコーポレーションのZeta001");
		expect([...table.values()]).toEqual(["Cell"]);
	});

	test("un marqueur Aphrody à largeur fixe reste restaurable avant un chiffre", () => {
		const { masque, table } = protegerTermes("超サイヤ人3", [
			{ ja: "サイヤ人", fr: "Saiyan", kind: "race" },
		], { prefixe: "QXZ", largeur: 4 });
		expect(masque).toBe("超QXZ00013");
		expect(restaurerJetons("Super QXZ00013", table, "QXZ", 4).texte).toBe("Super Saiyan3");
	});

	test("le plus long d'abord, quel que soit l'ordre du lexique", () => {
		const { texteMasque, termesTrouves } = masquerVocabulaire("孫悟空と超サイヤ人", { lexique: LEX });
		expect(termesTrouves.map((t) => t.ja)).toEqual(["孫悟空", "サイヤ人"]);
		expect(texteMasque).toBe("Zeta001と超Zeta002");
	});

	test("un jeton déjà posé n'est jamais re-masqué par un terme plus court", () => {
		const occ = occurrencesDuLexique("孫悟空", LEX);
		expect(occ).toHaveLength(1);
		expect(occ[0]!.terme.ja).toBe("孫悟空");
	});

	test("frontières de mot : katakana et latin, pas kanji", () => {
		expect(bordsDeMot("カプセル", 2, 4)).toBe(false);
		expect(bordsDeMot("のセルは", 1, 3)).toBe(true);
		expect(bordsDeMot("セルジュニア", 0, 2)).toBe(false);
		expect(bordsDeMot("ミスター・セル", 5, 7)).toBe(true);
		expect(bordsDeMot("悟空達", 0, 2)).toBe(true);
	});
});

describe("restauration des jetons — cas « Zêta010 » et « Terre Terre »", () => {
	test("« Zêta010 » accentué par le moteur est restauré", () => {
		const table = new Map([["Zeta010", "Tenshinhan"]]);
		const { texte, residuels } = restaurerJetons("* **Zêta010**\n* Un artiste martial", table);
		expect(texte).toBe("* **Tenshinhan**\n* Un artiste martial");
		expect(residuels).toEqual([]);
	});

	test("casse et séparateur tolérés, sans mordre sur un numéro plus long", () => {
		const table = new Map([
			["Zeta001", "Goku"],
			["Zeta0010", "Cell"],
		]);
		expect(restaurerJetons("ZETA 001 et zéta0010", table).texte).toBe("Goku et Cell");
	});

	test("un jeton inconnu reste en clair ET est signalé : la planche doit échouer", () => {
		const map = new Map([["Zeta001", { ja: "悟空", fr: "Goku", kind: "personnage" }]]);
		const r = demasquerVocabulaireStrict("Zeta001 affronte Zêta013", map);
		expect(r.texte).toBe("Goku affronte Zêta013");
		expect(r.residuels).toEqual(["Zêta013"]);
		expect(jetonsResiduels(demasquerVocabulaire("Zeta001 et Zêta013", map))).toEqual(["Zêta013"]);
	});

	test("« la Terre Zeta003 » (terme traduit ET jeton recopié) ne donne plus « Terre Terre »", () => {
		const table = new Map([["Zeta003", "Terre"]]);
		expect(restaurerJetons("sur la Terre Zeta003 pour fuir", table).texte).toBe("sur la Terre pour fuir");
		expect(restaurerJetons("Zeta003 terre natale", table).texte).toBe("terre natale");
	});

	test("un masquage puis une restauration aller-retour", () => {
		const { texteMasque, tokenMap } = masquerVocabulaire("天津飯は地球で一番強い", { lexique: LEX });
		const traduit = texteMasque.replace("は", " est le plus fort sur ").replace("で一番強い", "");
		expect(demasquerVocabulaire(traduit, tokenMap)).toBe("Tenshinhan est le plus fort sur Terre");
	});
});

describe("juge unique de dépôt", () => {
	const base = { databookId: 4, numero: 201, image: "./assets/wiki/databooks/a.jpg" };
	const SOURCE = "地球上の乗り物のなんと48%がカプセルコーポレーションの製品。基本設計はブリーフ自らが手がけている。";

	test("accepte une traduction saine", () => {
		expect(
			jugerTraduction({
				...base,
				source: SOURCE,
				traduction:
					"Près de 48 % des véhicules sur Terre sont des produits de Capsule Corporation. Leur conception est signée Brief lui-même.",
			})
		).toEqual({ ok: true });
	});

	test("refuse « Terre Terre » (doublon absent de la source)", () => {
		const v = jugerTraduction({
			...base,
			source: SOURCE,
			traduction: "Près de 48 % des véhicules sur Terre Terre sont conçus par Capsule Corporation. Brief lui-même.",
		});
		expect(v.ok).toBe(false);
		expect(!v.ok && v.motif).toContain("Terre Terre");
	});

	test("n'accuse pas les noms redoublés légitimes (Tao Pai Pai, Pui Pui)", () => {
		expect(motsDoublesAjoutes("Tao Pai Pai frappe", "桃白白が攻撃")).toEqual([]);
		expect(motsDoublesAjoutes("Pui Pui arrive", "プイプイが来た")).toEqual([]);
		expect(motsDoublesAjoutes("nous nous battons", "戦う")).toEqual([]);
		expect(motsDoublesAjoutes("le Cyborg Cyborg", "人造人間")).toEqual(["Cyborg Cyborg"]);
	});

	test("refuse un jeton « Zêta010 » en clair", () => {
		const v = jugerTraduction({
			databookId: 59,
			numero: 18,
			source: "画像に掲載されているキャラクターたちの設定や解説は以下の通りです。* **天津飯** 悟空と出会い心を入れ替えた武道家。",
			traduction: "Les réglages des personnages affichés sont les suivants. * **Zêta010** Un artiste martial qui a changé.",
		});
		expect(v.ok).toBe(false);
		expect(!v.ok && v.motif).toContain("jeton");
		expect(jetonsFuyants("Nova123 et Zeta 004", "")).toEqual(["Zeta 004", "Nova123"]);
		expect(jetonsFuyants("la carte No195", "No195 カード")).toEqual([]);
	});

	test("refuse la traduction de bruit OCR (« 的 あ 无 »)", () => {
		const bruit = "的 あ 无 口 上 ド 目 の 力 気";
		expect(bruitOcr(bruit)).not.toBeNull();
		expect(jugerTraduction({ ...base, source: bruit, traduction: "cible Ah Non bouche dessus Do oeil de force esprit" }).ok).toBe(
			false
		);
		const colonne = "BP\nスカウター\n箔\n裏\n漢\n星\n60000\nX3\n悟\n必\n五\n6";
		expect(bruitOcr(colonne)).toContain("lignes");
		expect(bruitOcr(SOURCE)).toBeNull();
	});

	test("refuse une copie de la source et une source française (tesseract-5-fra)", () => {
		const ocrFr = "DRAGON BALL\nLe Manga de Légende\nFascicule 01 — Son Goku et ses amis";
		expect(jugerTraduction({ ...base, source: ocrFr, traduction: ocrFr }).ok).toBe(false);
		expect(jugerTraduction({ ...base, source: SOURCE, traduction: SOURCE }).ok).toBe(false);
	});

	test("reprend les artefacts de l'audit a posteriori (« Croix Dispo »)", () => {
		const v = jugerTraduction({
			...base,
			source: "ディスクロスは強力なカードで、相手の攻撃を無効にする効果を持っている。",
			traduction: "La Croix Dispo est une carte puissante qui annule l'attaque adverse.",
		});
		expect(v.ok).toBe(false);
		expect(!v.ok && v.motif).toContain("Croix Dispo");
	});

	test("refuse un rapport de longueur absurde", () => {
		expect(jugerTraduction({ ...base, source: SOURCE, traduction: "Voiture." }).ok).toBe(false);
	});

	test("refuse le désalignement : numéro, image ou texte de la planche visée", () => {
		const travail = { ...base, source: SOURCE, traduction: "Près de 48 % des véhicules sur Terre sont des produits de Capsule Corporation, conçus par Brief." };
		expect(jugerTraduction(travail, { numero: 202, image: base.image, texte: SOURCE }).ok).toBe(false);
		expect(jugerTraduction(travail, { numero: 201, image: "./assets/wiki/databooks/b.jpg", texte: SOURCE }).ok).toBe(false);
		expect(jugerTraduction(travail, { numero: 201, image: base.image, texte: "別のページ" }).ok).toBe(false);
		expect(jugerTraduction(travail, { numero: 201, image: base.image, texte: `${SOURCE}\n` }).ok).toBe(true);
	});

	test("`sourceRelue` lève les juges de source, jamais ceux de la traduction", () => {
		const bruit = "BP\nスカウター\n箔\n裏\n漢\n星\n60000\nX3\n悟\n必\n五\n6";
		const fr = "BP\nScouter\nfeuille\nverso\nHan\nétoile\n60000\nX3\nGo\nNécessaire\ncinq\n6";
		expect(jugerTraduction({ ...base, source: bruit, traduction: fr }).ok).toBe(false);
		expect(jugerTraduction({ ...base, source: bruit, traduction: fr }, undefined, { sourceRelue: true }).ok).toBe(true);
		expect(
			jugerTraduction({ ...base, source: bruit, traduction: `${fr} Zeta001` }, undefined, { sourceRelue: true }).ok
		).toBe(false);
	});
});

// ── Écriture atomique : contre PostgreSQL, dans une table TEMPORAIRE ─────────
//
// Aucune ligne de `bot.db_databooks` n'est lue ni écrite : la table vit dans la
// session de test et disparaît au ROLLBACK final.

let sql: postgres.Sql | null = null;
try {
	const s = await connecte();
	await s`select 1`;
	sql = s;
} catch {
	sql = null;
}
afterAll(async () => {
	await sql?.end();
});

const ROLLBACK = new Error("rollback volontaire");
const TABLE = "db_databooks_ecriture_sure_test";

async function dansTableTemporaire(corps: (tx: postgres.TransactionSql) => Promise<void>) {
	await sql!
		.begin(async (tx) => {
			await tx`create temp table ${tx(TABLE)} (id bigint primary key, pages jsonb) on commit drop`;
			await tx`insert into ${tx(TABLE)} values (1, ${tx.json([
				{ number: 1, image: "./assets/wiki/databooks/p1.jpg", text: "一ページ目の本文" },
				{ number: 2, image: "./assets/wiki/databooks/p2.jpg", text: { kind: "text", markdown: "二ページ目の本文です" } },
				{ number: 3, image: "./assets/wiki/databooks/p3.jpg", text: "三ページ", text_fr: "Page trois", text_fr_by: "machine:x" },
				{ number: 4, image: "./assets/wiki/databooks/p4a.jpg", text: "" },
				{ number: 4, image: "./assets/wiki/databooks/p4b.jpg", text: "" },
			])}), (2, ${tx.json([{ number: 1, image: "x", text: "他の本" }])})`;
			await corps(tx);
			throw ROLLBACK;
		})
		.catch((e) => {
			if (e !== ROLLBACK) throw e;
		});
}

async function pages(tx: postgres.TransactionSql, id = 1) {
	const [r] = await tx<{ pages: Record<string, unknown>[] }[]>`select pages from ${tx(TABLE)} where id = ${id}`;
	return r!.pages;
}

describe.skipIf(sql === null)("écriture atomique d'une planche (PostgreSQL, table temporaire)", () => {
	test("pose des clés sur la seule planche visée, sans toucher aux autres ni aux autres ouvrages", async () => {
		await dansTableTemporaire(async (tx) => {
			const avant = await pages(tx);
			const res = await ecrirePlanche(
				tx,
				{ databookId: 1, numero: 2 },
				{ poser: { text_fr: "Page deux", text_fr_by: "test" } },
				{ texte: "二ページ目の本文です", traduction: "", image: "./assets/wiki/databooks/p2.jpg" },
				{ table: TABLE }
			);
			expect(res).toEqual({ applique: true, index: 1, avant: { texte: "二ページ目の本文です", traduction: "" } });
			const apres = await pages(tx);
			expect(apres[1]).toEqual({ ...avant[1], text_fr: "Page deux", text_fr_by: "test" });
			expect([apres[0], apres[2], apres[3], apres[4]]).toEqual([avant[0], avant[2], avant[3], avant[4]]);
			expect(await pages(tx, 2)).toEqual([{ number: 1, image: "x", text: "他の本" }]);
		});
	});

	test("gardes optimistes : texte, traduction, image — rien n'est écrit, le motif est rendu", async () => {
		await dansTableTemporaire(async (tx) => {
			const avant = await pages(tx);
			const opts = { table: TABLE };
			const poser = { poser: { text_fr: "X" } };
			expect((await ecrirePlanche(tx, { databookId: 1, numero: 1 }, poser, { texte: "autre" }, opts)).motif).toContain("garde texte");
			expect((await ecrirePlanche(tx, { databookId: 1, numero: 3 }, poser, { traduction: "" }, opts)).motif).toContain("déjà traduite");
			expect((await ecrirePlanche(tx, { databookId: 1, numero: 1 }, poser, { image: "./autre.jpg" }, opts)).motif).toContain("garde image");
			expect((await ecrirePlanche(tx, { databookId: 1, numero: 9 }, poser, {}, opts)).motif).toContain("absente");
			expect((await ecrirePlanche(tx, { databookId: 1, numero: 4 }, poser, {}, opts)).motif).toContain("ambigu");
			expect(await pages(tx)).toEqual(avant);
		});
	});

	test("retire des clés", async () => {
		await dansTableTemporaire(async (tx) => {
			const res = await ecrirePlanche(
				tx,
				{ databookId: 1, numero: 3 },
				{ retirer: ["text_fr", "text_fr_by"] },
				{ traduction: "Page trois" },
				{ table: TABLE }
			);
			expect(res.applique).toBe(true);
			expect((await pages(tx))[2]).toEqual({ number: 3, image: "./assets/wiki/databooks/p3.jpg", text: "三ページ" });
		});
	});

	test("deposerTraduction : le juge rejette avant toute écriture ; un second dépôt est un conflit", async () => {
		await dansTableTemporaire(async (tx) => {
			const opts = { table: TABLE, journal: () => {} };
			const travail = {
				databookId: 1,
				numero: 1,
				image: "./assets/wiki/databooks/p1.jpg",
				source: "一ページ目の本文",
				par: "test",
			};
			expect((await deposerTraduction(tx, { ...travail, traduction: "Zêta010 texte" }, opts)).statut).toBe("rejetee");
			expect((await pages(tx))[0]!.text_fr).toBeUndefined();
			const ok = await deposerTraduction(tx, { ...travail, traduction: "Le texte de la première page" }, opts);
			expect(ok.statut).toBe("ecrite");
			const bis = await deposerTraduction(tx, { ...travail, traduction: "Un autre texte de la page" }, opts);
			expect(bis.statut).toBe("conflit");
			expect((await pages(tx))[0]!.text_fr).toBe("Le texte de la première page");
		});
	});

	test("deposerTranscription : ne remplit qu'une planche vide, n'écrase jamais", async () => {
		await dansTableTemporaire(async (tx) => {
			const opts = { table: TABLE, journal: () => {} };
			const ecrase = await deposerTranscription(tx, { databookId: 1, numero: 1, texte: "Nouvelle lecture OCR" }, opts);
			expect(ecrase.statut).toBe("conflit");
			expect((await pages(tx))[0]!.text).toBe("一ページ目の本文");
		});
	});
});
