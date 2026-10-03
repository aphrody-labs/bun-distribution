// SPDX-License-Identifier: Apache-2.0
// Recherche manga sur le vrai PostgreSQL éditorial (transcriptions OCR) : aucune base vide ni test
// sauté. La frontière requireLiveRag refuse un préchargement RAG absent, partiel ou périmé.
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { loadLiveRagEnv, requireLiveRag } from "@shenron/pipeline/testing/live-rag";

// Mock de server-only pour permettre les tests dans l'environnement Bun
mock.module("server-only", () => ({}));

loadLiveRagEnv();
beforeAll(async () => {
	await requireLiveRag();
}, 120_000);

const { chercherPlanches, totalPlanchesPourRequete } = await import("../src/lib/manga-api");
const { GET } = await import("../src/app/api/manga/search/route");

describe("chercherPlanches & totalPlanchesPourRequete — citations françaises", () => {
	test("recherche du mot célèbre 'Kamehameha'", async () => {
		const resultats = await chercherPlanches("Kamehameha", 5);
		expect(resultats.length).toBeGreaterThan(0);
		expect(resultats.length).toBeLessThanOrEqual(5);

		const premier = resultats[0]!;
		expect(premier.series).toBe("DB");
		expect(premier.score).toBeGreaterThan(80);
		expect(premier.extrait.toLowerCase()).toContain("kamehameha");
		expect(premier.snippet).toContain("<mark>");
		expect(premier.planche).toBeGreaterThan(0);
		expect(premier.href).toContain("/wiki/manga/");
		expect(premier.api).toContain("/api/manga/chapter/");
	});

	test("citation célèbre 'Je suis Son Goku, le Super Saiyan'", async () => {
		const resultats = await chercherPlanches("Je suis Son Goku, le Super Saiyan", 5);
		expect(resultats.length).toBeGreaterThan(0);

		// Doit retrouver la réplique culte face à Freezer dans le tome 27
		const trouve = resultats.some(
			(r) => r.tome === "vol27" || r.extrait.toLowerCase().includes("super saiyan")
		);
		expect(trouve).toBe(true);
		expect(resultats[0]!.score).toBeGreaterThan(25);
		expect(resultats[0]!.snippet).toContain("<mark>");
	});

	test("citation célèbre 'C'est fini Freezer'", async () => {
		const resultats = await chercherPlanches("C'est fini Freezer", 5);
		expect(resultats.length).toBeGreaterThan(0);

		// Les résultats doivent mentionner Freezer
		const mentionFreezer = resultats.some((r) => r.extrait.toLowerCase().includes("freezer"));
		expect(mentionFreezer).toBe(true);
	});

	test("totalPlanchesPourRequete retourne le total global des correspondances", async () => {
		const total = await totalPlanchesPourRequete("Kamehameha");
		expect(total).toBeGreaterThan(200);

		const petitTotal = await totalPlanchesPourRequete("Genkidama");
		expect(petitTotal).toBeGreaterThan(0);
		expect(petitTotal).toBeLessThan(total);
	});

	test("requêtes trop courtes ou vides (< 2 caractères)", async () => {
		expect(await chercherPlanches("")).toEqual([]);
		expect(await chercherPlanches("a")).toEqual([]);
		expect(await totalPlanchesPourRequete("")).toBe(0);
		expect(await totalPlanchesPourRequete("x")).toBe(0);
	});
});

describe("recherche en japonais (multisyllabique, kanjis et katakana)", () => {
	test("terme japonais avec kanji : 'かめはめ波'", async () => {
		const resultats = await chercherPlanches("かめはめ波", 5);
		expect(resultats.length).toBeGreaterThan(0);

		const top = resultats[0]!;
		expect(top.score).toBeGreaterThan(50);
		expect(top.snippet).toContain("<mark>かめはめ波</mark>");
	});

	test("terme katakana : 'フリーザ'", async () => {
		const resultats = await chercherPlanches("フリーザ", 5);
		expect(resultats.length).toBeGreaterThan(0);
		expect(resultats[0]!.snippet).toContain("<mark>フリーザ</mark>");
	});

	test("multi-termes japonais avec kanji : '孫悟空 かめはめ波'", async () => {
		const resultats = await chercherPlanches("孫悟空 かめはめ波", 5);
		expect(resultats.length).toBeGreaterThan(0);
		expect(resultats[0]!.score).toBeGreaterThan(40);
	});

	test("termes absents de la base ('クリリン', 'カカロット') ne provoquent pas d'erreur", async () => {
		const kuririn = await chercherPlanches("クリリン", 5);
		expect(kuririn).toEqual([]);

		const kakarotto = await chercherPlanches("カカロット", 5);
		expect(kakarotto).toEqual([]);

		const totalKuririn = await totalPlanchesPourRequete("クリリン");
		expect(totalKuririn).toBe(0);
	});
});

describe("tolérance à la ponctuation française et japonaise", () => {
	test("guillemets français « » et guillemets droits \" \"", async () => {
		const brut = await chercherPlanches("Kamehameha", 5);
		const avecGuillemets = await chercherPlanches("« Kamehameha »", 5);
		const avecGuillemetsDroits = await chercherPlanches('"Kamehameha"', 5);

		expect(brut.length).toBeGreaterThan(0);
		expect(avecGuillemets.length).toBe(brut.length);
		expect(avecGuillemetsDroits.length).toBe(brut.length);
		expect(avecGuillemets[0]!.planche).toBe(brut[0]!.planche);
		expect(avecGuillemets[0]!.score).toBe(brut[0]!.score);
	});

	test("points d'exclamation et interrogation mélangés", async () => {
		const res1 = await chercherPlanches("Kamehameha !!", 3);
		const res2 = await chercherPlanches("C'est fini Freezer !?", 3);
		expect(res1.length).toBeGreaterThan(0);
		expect(res2.length).toBeGreaterThan(0);
	});

	test("guillemets japonais 「」 et ponctuation japonaise", async () => {
		const brut = await chercherPlanches("かめはめ波", 3);
		const avecPonct = await chercherPlanches("「かめはめ波！」", 3);

		expect(brut.length).toBeGreaterThan(0);
		expect(avecPonct.length).toBe(brut.length);
		expect(avecPonct[0]!.tome).toBe(brut[0]!.tome);
		expect(avecPonct[0]!.planche).toBe(brut[0]!.planche);
	});
});

describe("filtrage par série, par tome et pagination", () => {
	test("filtrage par série : db vs dbs", async () => {
		const planchesDb = await chercherPlanches("Kamehameha", { limit: 10, series: "db" });
		expect(planchesDb.length).toBeGreaterThan(0);
		for (const p of planchesDb) {
			expect(p.series).toBe("DB");
		}

		const planchesDbs = await chercherPlanches("Kamehameha", { limit: 10, series: "dbs" });
		expect(planchesDbs.length).toBeGreaterThan(0);
		for (const p of planchesDbs) {
			expect(p.series).toBe("DBS");
		}

		// Vérification cohérence totalPlanchesPourRequete
		const totalDb = await totalPlanchesPourRequete("Kamehameha", { series: "DB" });
		const totalDbs = await totalPlanchesPourRequete("Kamehameha", { series: "DBS" });
		const totalGlobal = await totalPlanchesPourRequete("Kamehameha");
		expect(totalDb + totalDbs).toBe(totalGlobal);
	});

	test("filtrage par tome (numérique ou préfixé 'vol')", async () => {
		const parTomeVol = await chercherPlanches("Kamehameha", { limit: 10, tome: "vol2" });
		expect(parTomeVol.length).toBeGreaterThan(0);
		for (const p of parTomeVol) {
			expect(p.tome).toBe("vol2");
		}

		const parTomeNum = await chercherPlanches("Kamehameha", { limit: 10, tome: "2", series: "db" });
		expect(parTomeNum.length).toBeGreaterThan(0);
		for (const p of parTomeNum) {
			expect(p.tome).toBe("vol2");
		}

		const totalTome2 = await totalPlanchesPourRequete("Kamehameha", { tome: "vol2" });
		expect(totalTome2).toBeGreaterThan(0);
		expect(totalTome2).toBeLessThan(await totalPlanchesPourRequete("Kamehameha"));
	});

	test("pagination : offset et limit", async () => {
		const page1 = await chercherPlanches("Kamehameha", { limit: 3, offset: 0 });
		const page2 = await chercherPlanches("Kamehameha", { limit: 3, offset: 3 });

		expect(page1.length).toBe(3);
		expect(page2.length).toBe(3);

		// Les deux pages doivent être disjointes
		const clesPage1 = page1.map((p) => `${p.series}:${p.tome}:${p.planche}`);
		const clesPage2 = page2.map((p) => `${p.series}:${p.tome}:${p.planche}`);
		for (const k of clesPage1) {
			expect(clesPage2).not.toContain(k);
		}
	});

	test("pagination : paramètre page (1-indexé)", async () => {
		const p1 = await chercherPlanches("Kamehameha", { limit: 2, page: 1 });
		const p2 = await chercherPlanches("Kamehameha", { limit: 2, page: 2 });
		const off2 = await chercherPlanches("Kamehameha", { limit: 2, offset: 2 });

		expect(p1.length).toBe(2);
		expect(p2.length).toBe(2);
		expect(p2[0]!.planche).toBe(off2[0]!.planche);
		expect(p2[0]!.tome).toBe(off2[0]!.tome);
	});
});

describe("mise en valeur des extraits (snippets avec <mark>)", () => {
	test("snippet systématiquement surligné avec <mark>", async () => {
		const res = await chercherPlanches("Kamehameha", 3);
		for (const p of res) {
			expect(p.snippet).toContain("<mark>");
			expect(p.snippet).toContain("</mark>");
		}
	});

	test("option surligner: true applique les balises aussi dans extrait", async () => {
		const sansOpt = await chercherPlanches("Kamehameha", { limit: 1, surligner: false });
		const avecOpt = await chercherPlanches("Kamehameha", { limit: 1, surligner: true });

		expect(sansOpt[0]!.extrait).not.toContain("<mark>");
		expect(avecOpt[0]!.extrait).toContain("<mark>");
		expect(sansOpt[0]!.snippet).toContain("<mark>");
	});
});

describe("Route API HTTP GET /api/manga/search", () => {
	test("renvoie un JSON valide avec les champs q, count et resultats", async () => {
		const req = new Request("http://localhost:3000/api/manga/search?q=kamehameha&limit=2");
		const res = await GET(req);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.q).toBe("kamehameha");
		expect(data.count).toBe(2);
		expect(Array.isArray(data.resultats)).toBe(true);
		expect(data.resultats[0].snippet).toContain("<mark>");
	});

	test("filtre par série et tome via query parameters", async () => {
		const req = new Request(
			"http://localhost:3000/api/manga/search?q=kamehameha&limit=5&series=db&tome=vol2"
		);
		const res = await GET(req);
		expect(res.status).toBe(200);

		const data = await res.json();
		for (const r of data.resultats) {
			expect(r.series).toBe("DB");
			expect(r.tome).toBe("vol2");
		}
	});

	test("erreur 400 si q est manquant ou trop court", async () => {
		const req1 = new Request("http://localhost:3000/api/manga/search?q=");
		const res1 = await GET(req1);
		expect(res1.status).toBe(400);

		const req2 = new Request("http://localhost:3000/api/manga/search?q=a");
		const res2 = await GET(req2);
		expect(res2.status).toBe(400);
	});
});
