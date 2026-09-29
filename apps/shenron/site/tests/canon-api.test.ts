process.env.SHENRON_API_URL = "http://127.0.0.1:5006";
process.env.NEXT_PUBLIC_SHENRON_API_URL = "http://127.0.0.1:5006";

import type { NextRequest as NextRequestType } from "next/server";
import { describe, expect, test } from "bun:test";
import { mock } from "bun:test";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

// Mock server-only pour permettre l'import des handlers Next.js dans Bun test
mock.module("server-only", () => ({}));

// Chargement défensif de DATABASE_URL pour Bun test
if (!process.env.DATABASE_URL) {
	try {
		const envPath = join(import.meta.dir, "..", ".env");
		if (existsSync(envPath)) {
			const text = readFileSync(envPath, "utf-8");
			const line = text
				.split("\n")
				.filter((l) => l.startsWith("DATABASE_URL="))
				.at(-1);
			if (line) {
				process.env.DATABASE_URL = line
					.slice("DATABASE_URL=".length)
					.trim()
					.replace(/^["']|["']$/g, "");
			}
		}
	} catch {
		// Repli sans base : les handlers retomberont sur la configuration par défaut
	}
}

// Routage local ultra-rapide vers le service Shenron bot local (port 5006)
process.env.SHENRON_API_URL = "http://127.0.0.1:5006";
process.env.NEXT_PUBLIC_SHENRON_API_URL = "http://127.0.0.1:5006";

const { NextRequest } = await import("next/server");
const { GET: getCanon, OPTIONS: optionsCanon } = await import("../src/app/api/canon/route");
const { GET: getCanonReferences, OPTIONS: optionsReferences } = await import(
	"../src/app/api/canon/references/route"
);
const { canonPreuves } = await import("../src/lib/canon-preuves");
const { CANON_TIERS } = await import("../src/lib/canon-engine");

function createReq(url: string, method = "GET"): NextRequestType {
	return new NextRequest(new URL(url, "http://localhost:3000"), { method });
}

describe("API Canon (/api/canon) — Doctrine & Requêtes Vides", () => {
	test("OPTIONS /api/canon renvoie 204 avec les en-têtes CORS complets", async () => {
		const res = optionsCanon();
		expect(res.status).toBe(204);
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
		expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
		expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Content-Type");
	});

	test("GET /api/canon (requête vide) renvoie la doctrine, les tiers et les sources officielles", async () => {
		const req = createReq("/api/canon");
		const res = await getCanon(req);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.intro).toBeString();
		expect(data.intro.length).toBeGreaterThan(10);

		// 5 Tiers immuables
		expect(data.tiers).toBeArray();
		expect(data.tiers).toHaveLength(5);
		for (const tier of data.tiers) {
			expect(CANON_TIERS).toContain(tier.id);
			expect(tier.label).toBeString();
			expect(tier.court).toBeString();
			expect(tier.couleur).toMatch(/^#[0-9a-f]{3,8}$/i);
			expect(tier.score).toBeNumber();
			expect(tier.definition).toBeString();
			expect(tier.inclut).toBeArray();
			expect(tier.inclut.length).toBeGreaterThan(0);
		}

		// Doctrine
		expect(data.doctrine).toBeArray();
		expect(data.doctrine.length).toBeGreaterThan(0);

		// Sources admises vs interdites (anti-fandom)
		expect(data.sourcesAdmises).toBeArray();
		expect(data.sourcesAdmises.length).toBeGreaterThan(0);
		expect(data.sourcesInterdites).toBeArray();
		expect(data.sourcesInterdites.length).toBeGreaterThan(0);

		// Sujets et règles
		expect(data.entries).toBeArray();
		expect(data.entries.length).toBeGreaterThanOrEqual(20);
		expect(data.heuristics).toBeArray();
		expect(data.heuristics.length).toBeGreaterThanOrEqual(5);

		// Statistiques
		expect(data.stats).toBeDefined();
		expect(data.stats.references).toBeNumber();
		expect(data.stats.references).toBeGreaterThanOrEqual(0);
		expect(data.stats.parProvenance).toBeObject();
	});

	test("GET /api/canon?q=   (espaces seuls) est traité comme requête vide", async () => {
		const req = createReq("/api/canon?q=%20%20%20");
		const res = await getCanon(req);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.tiers).toBeArray();
		expect(data.tiers).toHaveLength(5);
		expect(data.doctrine).toBeArray();
	});
});

describe("API Canon (/api/canon) — Requêtes Canoniques Claires", () => {
	test("Goku est-il un Saiyan ? -> CANON_ABSOLU (Kakarotto, Tome 17 Ch. 195)", async () => {
		const req = createReq("/api/canon?q=Goku%20est-il%20un%20Saiyan%20%3F");
		const res = await getCanon(req);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.question).toBe("Goku est-il un Saiyan ?");
		expect(data.verdict.tier).toBe("CANON_ABSOLU");
		expect(data.verdict.score).toBe(100);
		expect(data.verdict.nature).toBe("verdict");
		expect(data.verdict.origine).toBe("entry:goku-saiyan-kakarotto");
		expect(data.verdict.sources).toContain("Manga Dragon Ball Tome 17 (Chapitre 195)");
		expect(data.verdict.toriyamaQuote).toBeDefined();
		expect(data.verdict.toriyamaQuote.text).toContain("Saiyan");
	});

	test("Mère de Goku -> CANON_ABSOLU (Gine, Dragon Ball Minus)", async () => {
		const req = createReq("/api/canon?q=M%C3%A8re%20de%20Goku");
		const res = await getCanon(req);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.verdict.tier).toBe("CANON_ABSOLU");
		expect(data.verdict.score).toBe(100);
		expect(data.verdict.explanation).toContain("Gine");
		expect(data.verdict.sources).toContain("Dragon Ball Minus (2014)");
	});

	test("Freezer a détruit la planète Vegeta -> CANON_ABSOLU (Manga Ch. 257)", async () => {
		const req = createReq("/api/canon?q=Freezer%20a%20d%C3%A9truit%20la%20plan%C3%A8te%20Vegeta");
		const res = await getCanon(req);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.verdict.tier).toBe("CANON_ABSOLU");
		expect(data.verdict.score).toBe(100);
		expect(data.verdict.origine).toBe("entry:destruction-planete-vegeta");
		expect(data.verdict.sources).toContain("Manga Dragon Ball Tome 22 (Chapitre 257)");
	});

	test("Broly DBS -> CANON_SUPERVISE (Film 2018 par Toriyama)", async () => {
		const req = createReq("/api/canon?q=Broly%20DBS");
		const res = await getCanon(req);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.verdict.tier).toBe("CANON_SUPERVISE");
		expect(data.verdict.score).toBe(85);
		expect(data.verdict.verdict).toContain("2018");
		expect(data.verdict.toriyamaQuote).toBeDefined();
	});

	test("Beerus dort 39 ans -> CANON_SUPERVISE (Battle of Gods / Poisson Oracle)", async () => {
		const req = createReq("/api/canon?q=Beerus%20dort%2039%20ans");
		const res = await getCanon(req);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.verdict.tier).toBe("CANON_SUPERVISE");
		expect(data.verdict.score).toBe(98);
		expect(data.verdict.explanation).toContain("39 ans");
	});

	test("Tarble -> CANON_SUPERVISE (OAV 2008 écrit par Toriyama & Battle of Gods)", async () => {
		const req = createReq("/api/canon?q=Tarble");
		const res = await getCanon(req);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.verdict.tier).toBe("CANON_SUPERVISE");
		expect(data.verdict.score).toBe(90);
		expect(data.verdict.verdict).toContain("2008");
	});

	test("Daima Realm / Royaume des Démons -> CANON_SUPERVISE (Dragon Ball Daima)", async () => {
		const req = createReq("/api/canon?q=Daima%20Realm");
		const res = await getCanon(req);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.verdict.tier).toBe("CANON_SUPERVISE");
		expect(data.verdict.score).toBe(98);
		expect(data.verdict.origine).toBe("entry:daima");
	});
});

describe("API Canon (/api/canon) — Requêtes Non-Canoniques & Fillers Toei", () => {
	test("Broly DBZ 1993 -> NON_CANON_DERIVE (Films Z Takao Koyama)", async () => {
		const req = createReq("/api/canon?q=Broly%20DBZ%201993");
		const res = await getCanon(req);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.verdict.tier).toBe("NON_CANON_DERIVE");
		expect(data.verdict.score).toBe(20);
		expect(data.verdict.origine).toBe("entry:broly-dbz-1993");
		expect(data.verdict.verdict).toContain("Non-canonique");
	});

	test("Super Saiyan 4 -> NON_CANON_DERIVE (GT / Katsuyoshi Nakatsuru)", async () => {
		const req = createReq("/api/canon?q=Super%20Saiyan%204");
		const res = await getCanon(req);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.verdict.tier).toBe("NON_CANON_DERIVE");
		expect(data.verdict.score).toBe(15);
		expect(data.verdict.verdict).toContain("Katsuyoshi Nakatsuru");
	});

	test("Cooler -> NON_CANON_DERIVE (Films 5 et 6 Toei)", async () => {
		const req = createReq("/api/canon?q=Cooler");
		const res = await getCanon(req);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.verdict.tier).toBe("NON_CANON_DERIVE");
		expect(data.verdict.score).toBe(20);
	});

	test("Janemba -> NON_CANON_DERIVE (Film 12 Fusions 1995)", async () => {
		const req = createReq("/api/canon?q=Janemba");
		const res = await getCanon(req);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.verdict.tier).toBe("NON_CANON_DERIVE");
		expect(data.verdict.score).toBe(20);
	});

	test("Tapion -> NON_CANON_DERIVE (L'Attaque du Dragon 1995)", async () => {
		const req = createReq("/api/canon?q=Tapion");
		const res = await getCanon(req);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.verdict.tier).toBe("NON_CANON_DERIVE");
		expect(data.verdict.score).toBe(20);
	});
});

describe("API Canon (/api/canon) — Retcons, Débats Complexes & Comparaisons", () => {
	test("Gine est-elle canon ? -> CANON_ABSOLU (Toriyama dans Minus)", async () => {
		const req = createReq("/api/canon?q=Gine%20est-elle%20canon%20%3F");
		const res = await getCanon(req);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.verdict.tier).toBe("CANON_ABSOLU");
		expect(data.verdict.score).toBe(100);
	});

	test("Bardock TV Special vs Minus -> NON_CANON_DERIVE (Scénario téléfilm supplanté par Minus)", async () => {
		const req = createReq("/api/canon?q=Bardock%20TV%20Special%20vs%20Minus");
		const res = await getCanon(req);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.verdict.tier).toBe("NON_CANON_DERIVE");
		expect(data.verdict.score).toBe(30);
		expect(data.verdict.origine).toBe("entry:bardock-tv-special-1990");
		expect(data.verdict.explanation).toContain("Minus");
	});

	test("Super Saiyan 5 -> APOCRYPHE_FANON (Canular Tablos / AF 1999)", async () => {
		const req = createReq("/api/canon?q=Super%20Saiyan%205");
		const res = await getCanon(req);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.verdict.tier).toBe("APOCRYPHE_FANON");
		expect(data.verdict.score).toBe(0);
		expect(data.verdict.verdict).toContain("Apocryphe");
	});

	test("Gregory est-il dans le manga ? -> NON_CANON_DERIVE (Filler Toei absent du manga)", async () => {
		const req = createReq("/api/canon?q=Gregory%20est-il%20dans%20le%20manga%20%3F");
		const res = await getCanon(req);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.verdict.tier).toBe("NON_CANON_DERIVE");
		expect(data.verdict.score).toBe(20);
		expect(data.verdict.origine).toBe("entry:gregory-kaio");
		expect(data.verdict.explanation).toContain("Bubbles");
	});

	test("Gogeta vs Vegito -> EXTENSION_OFFICIELLE (Comparaison Potara vs Métamol du SEG)", async () => {
		const req = createReq("/api/canon?q=Gogeta%20vs%20Vegito");
		const res = await getCanon(req);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.verdict.tier).toBe("EXTENSION_OFFICIELLE");
		expect(data.verdict.origine).toBe("entry:fusion-potara-vs-metamol-puissance");
		expect(data.verdict.verdict).toContain("Potaras");
	});

	test("SSJ4 vs SSJG -> NON_CANON_DERIVE (Distingue Canon Supervisé et Hors Continuité)", async () => {
		const req = createReq("/api/canon?q=SSJ4%20vs%20SSJG");
		const res = await getCanon(req);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.verdict.tier).toBe("NON_CANON_DERIVE");
		expect(data.verdict.origine).toBe("entry:ssj4-vs-ssjg");
		expect(data.verdict.verdict).toContain("Super Saiyan God est Canon Supervisé");
	});
});

describe("API Canon (/api/canon) — Cas Limites, Typographie & Trolls", () => {
	test("Ponctuation complexe : guillemets, tirets et points multiples", async () => {
		const req = createReq('/api/canon?q=«%20Broly%20»%20--%20DBZ%201993%20%3F%21%3F%21');
		const res = await getCanon(req);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.verdict.tier).toBe("NON_CANON_DERIVE");
		expect(data.verdict.origine).toBe("entry:broly-dbz-1993");
	});

	test("Accents et casses hétérogènes : mÈrE dE gOkU ???", async () => {
		const req = createReq("/api/canon?q=m%C3%88rE%20dE%20gOkU%20%3F%3F%3F");
		const res = await getCanon(req);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.verdict.tier).toBe("CANON_ABSOLU");
		expect(data.verdict.origine).toBe("entry:gine");
	});

	test("Typographie japonaise pleine chasse (Zenkaku) : Ｂｒｏｌｙ ＤＢＺ １９９３ ？？", async () => {
		const req = createReq("/api/canon?q=%EF%BC%A2%EF%BD%92%EF%BD%8F%EF%BD%8C%EF%BD%99%20%EF%BC%A4%EF%BC%A2%EF%BC%BA%20%EF%BC%91%EF%BC%99%EF%BC%99%EF%BC%93%EF%BC%9F%EF%BC%9F");
		const res = await getCanon(req);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.verdict.tier).toBe("NON_CANON_DERIVE");
		expect(data.verdict.origine).toBe("entry:broly-dbz-1993");
	});

	test("Katakana japonais avec particule : ブロリーは正史ですか？", async () => {
		const req = createReq("/api/canon?q=%E3%83%96%E3%83%AD%E3%83%AA%E3%83%BC%E3%81%AF%E6%AD%A3%E5%8F%B2%E3%81%A7%E3%81%99%E3%81%8B%EF%BC%9F");
		const res = await getCanon(req);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.verdict.tier).toBe("CANON_SUPERVISE");
		expect(data.verdict.origine).toBe("entry:broly");
	});

	test("Requête très longue (> 400 caractères) : tronquée proprement sans erreur 500", async () => {
		const longText =
			"Goku est-il un Saiyan ? Dans le manga d'Akira Toriyama, Raditz arrive et explique que Son Goku est en réalité un guerrier de la planète Vegeta envoyé sur Terre. ".repeat(
				4
			);
		const req = createReq(`/api/canon?q=${encodeURIComponent(longText)}`);
		const res = await getCanon(req);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.question.length).toBeLessThanOrEqual(400);
		expect(data.verdict.tier).toBe("CANON_ABSOLU");
	});

	test("Troll Crossover : Goku vs Superman -> Refus argumenté (nature: troll)", async () => {
		const req = createReq("/api/canon?q=Goku%20vs%20Superman");
		const res = await getCanon(req);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.verdict.nature).toBe("troll");
		expect(data.verdict.tier).toBe("APOCRYPHE_FANON");
		expect(data.verdict.origine).toBe("troll:crossover");
		expect(data.verdict.explanation).toContain("Aucune source officielle");
	});

	test("Troll Forme inventée : Super Saiyan 100 -> Refus argumenté (nature: troll)", async () => {
		const req = createReq("/api/canon?q=Super%20Saiyan%20100");
		const res = await getCanon(req);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.verdict.nature).toBe("troll");
		expect(data.verdict.origine).toBe("troll:invention");
	});
});

describe("API Canon References (/api/canon/references) — Corpus de preuves", () => {
	test("OPTIONS /api/canon/references renvoie 204 avec en-têtes CORS", async () => {
		const res = optionsReferences();
		expect(res.status).toBe(204);
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
	});

	test("GET /api/canon/references (liste paginée par défaut)", async () => {
		const req = createReq("/api/canon/references?limit=10&offset=0");
		const res = await getCanonReferences(req);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.limit).toBe(10);
		expect(data.offset).toBe(0);
		expect(data.total).toBeNumber();
		expect(data.items).toBeArray();
		expect(data.items.length).toBeLessThanOrEqual(10);

		if (data.items.length > 0) {
			const item = data.items[0];
			expect(item.id).toBeString();
			expect(item.subject).toBeString();
			expect(item.text).toBeString();
			expect(item.source).toBeString();
			expect(item.provenance).toBeString();
		}
	});

	test("GET /api/canon/references avec filtre q=broly", async () => {
		const req = createReq("/api/canon/references?q=broly&limit=5");
		const res = await getCanonReferences(req);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.q).toBe("broly");
		expect(data.items).toBeArray();
		for (const item of data.items) {
			const contenu = `${item.subject} ${item.text} ${item.textFr ?? ""} ${item.keywords.join(" ")}`.toLowerCase();
			expect(contenu).toContain("broly");
		}
	});

	test("GET /api/canon/references avec filtre provenance=databooks", async () => {
		const req = createReq("/api/canon/references?provenance=databooks&limit=5");
		const res = await getCanonReferences(req);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.provenance).toBe("databooks");
		for (const item of data.items) {
			expect(item.provenance).toBe("databooks");
		}
	});

	test("GET /api/canon/references avec provenance inconnue (repli propre)", async () => {
		const req = createReq("/api/canon/references?provenance=invalide&limit=5");
		const res = await getCanonReferences(req);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.provenance).toBeNull();
	});
});

describe("canonPreuves() — Agrégation des Preuves", () => {
	test("canonPreuves('') sur requête vide retourne sans planches ni fiches sans crash", async () => {
		const res = await canonPreuves("");
		expect(res.verdict.nature).toBe("empty");
		expect(res.planches).toHaveLength(0);
		expect(res.fiches).toHaveLength(0);
		expect(res.suggestions).toHaveLength(0);
	});

	test("canonPreuves('Goku vs Superman') sur troll n'effectue aucune recherche de fiches", async () => {
		const res = await canonPreuves("Goku vs Superman");
		expect(res.verdict.nature).toBe("troll");
		expect(res.planches).toHaveLength(0);
		expect(res.fiches).toHaveLength(0);
	});

	test("canonPreuves('Broly') agrège verdict, suggestions et planches/fiches internes", async () => {
		const res = await canonPreuves("Broly");
		expect(res.verdict.tier).toBe("CANON_SUPERVISE");
		expect(res.suggestions.length).toBeGreaterThan(0);
		for (const s of res.suggestions) {
			expect(s.href).toMatch(/^\/wiki\/canon\?q=/);
		}

		// Si le corpus RAG a rendu des fiches, vérifier l'étanchéité des routes internes
		for (const f of res.fiches) {
			expect(f.href).toMatch(/^\/wiki\//);
			expect(f.href).not.toContain("fandom.com");
		}
	});
});
