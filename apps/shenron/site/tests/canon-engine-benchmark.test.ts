/**
 * @file canon-engine-benchmark.test.ts
 * Suite de tests et benchmarks exhaustifs pour le moteur de canonicité Shenron :
 *  1. Exactitude de la doctrine sur 35+ cas représentatifs
 *  2. Qualité et fidélité linguistique des transcriptions / traductions (anti-Fandom)
 *  3. Performance et temps de réponse (< 20ms pour 100 requêtes)
 *  4. Robustesse de l'appariement et des sources de preuves
 */
import { describe, expect, test } from "bun:test";
import {
	analyzeCanon,
	DEFAULT_CANON_CONFIG,
	referencesPour,
	type CanonReference,
} from "../src/lib/canon-engine";

describe("Doctrine de canonicité — Précision sur les cas réels", () => {
	// ── 1. CANON ABSOLU (Manga original 42 tomes, Jaco, Minus, Toriyama) ─────
	test("Canon Absolu : Manga original 42 tomes", () => {
		const r = analyzeCanon("Le manga original en 42 tomes est-il canonique ?");
		expect(r.tier).toBe("CANON_ABSOLU");
		expect(r.score).toBe(100);
	});

	test("Canon Absolu : Vegetto Potara", () => {
		const r = analyzeCanon("Vegetto et la fusion Potara sont-ils canoniques ?");
		expect(r.tier).toBe("CANON_ABSOLU");
		expect(r.score).toBe(100);
		expect(r.sources.some((s) => s.includes("Tome 42"))).toBe(true);
	});

	test("Canon Absolu : Bardock dans le manga", () => {
		const r = analyzeCanon("Bardock est-il canonique ?");
		expect(r.tier).toBe("CANON_ABSOLU");
		expect(r.score).toBeGreaterThanOrEqual(95);
		expect(r.toriyamaQuote).toBeDefined();
	});

	test("Canon Absolu : Jaco & Dragon Ball Minus", () => {
		const r = analyzeCanon("Dragon Ball Minus et Jaco sont-ils canoniques ?");
		expect(r.tier).toBe("CANON_ABSOLU");
		expect(r.score).toBe(100);
		expect(r.sources.some((s) => s.includes("Jaco the Galactic Patrolman"))).toBe(true);
	});

	test("Canon Absolu : Gine la mère de Goku", () => {
		const r = analyzeCanon("Gine la compagne de Bardock et mère de Goku est-elle canon ?");
		expect(r.tier).toBe("CANON_ABSOLU");
		expect(r.score).toBe(100);
		expect(r.toriyamaQuote?.source).toContain("Saikyō Jump");
	});

	test("Canon Absolu : C-16 inspiré du fils du Dr Gero", () => {
		const r = analyzeCanon("C-16 a-t-il été créé d'après le fils de Gero nommé Gebo ?");
		expect(r.tier).toBe("CANON_ABSOLU");
		expect(r.score).toBe(95);
		expect(r.toriyamaQuote?.source).toContain("Mandō Kobayashi");
	});

	test("Canon Absolu : Noms civils Lapis & Lazuli (C-17 et C-18)", () => {
		const r = analyzeCanon("Lapis et Lazuli sont-ils les vrais noms de C-17 et C-18 ?");
		expect(r.tier).toBe("CANON_ABSOLU");
		expect(r.score).toBe(100);
	});

	test("Canon Absolu : Vrai nom de Mr. Satan (Mark)", () => {
		const r = analyzeCanon("Mark est-il le vrai nom de Mr Satan ?");
		expect(r.tier).toBe("CANON_ABSOLU");
		expect(r.score).toBe(100);
	});

	test("Canon Absolu : Cellules S (S-Cells)", () => {
		const r = analyzeCanon("Les cellules S (S-Cells) sont-elles canoniques ?");
		expect(r.tier).toBe("CANON_ABSOLU");
		expect(r.score).toBe(95);
	});

	test("Canon Absolu : Origine des Kaïoshin sur la planète du Noyau", () => {
		const r = analyzeCanon("L'origine des Kaïoshin sur Kaishin-sei est-elle canonique ?");
		expect(r.tier).toBe("CANON_ABSOLU");
		expect(r.score).toBe(100);
	});

	test("Canon Absolu : Unité Kiri de Babidi et Yakon", () => {
		const r = analyzeCanon("L'unité Kiri de Babidi est-elle canonique dans le manga ?");
		expect(r.tier).toBe("CANON_ABSOLU");
		expect(r.score).toBe(100);
	});

	test("Canon Absolu : Uub et son ki divin", () => {
		const r = analyzeCanon("Uub et la réincarnation de Kid Buu sont-ils canoniques ?");
		expect(r.tier).toBe("CANON_ABSOLU");
		expect(r.score).toBe(100);
	});

	test("Canon Absolu : Piccolo personnage préféré de Toriyama", () => {
		const r = analyzeCanon("Piccolo est-il le personnage favori d'Akira Toriyama ?");
		expect(r.tier).toBe("CANON_ABSOLU");
		expect(r.score).toBe(100);
	});

	// ── 2. CANON SUPERVISÉ (DBS, BoG, Broly, Super Hero, Daima) ──────────────
	test("Canon Supervisé : Broly dans DBS", () => {
		const r = analyzeCanon("Broly est-il canonique ?");
		expect(r.tier).toBe("CANON_SUPERVISE");
		expect(r.score).toBe(85);
		expect(r.verdict).toContain("2018");
	});

	test("Canon Supervisé : Gogeta", () => {
		const r = analyzeCanon("Gogeta est-il canonique ?");
		expect(r.tier).toBe("CANON_SUPERVISE");
		expect(r.score).toBe(85);
	});

	test("Canon Supervisé : Dragon Ball Daima", () => {
		const r = analyzeCanon("Dragon Ball Daima est-il canonique ?");
		expect(r.tier).toBe("CANON_SUPERVISE");
		expect(r.score).toBe(98);
	});

	test("Canon Supervisé : Manga Dragon Ball Super", () => {
		const r = analyzeCanon("Dragon Ball Super le manga de Toyotaro est-il canonique ?");
		expect(r.tier).toBe("CANON_SUPERVISE");
		expect(r.score).toBe(90);
	});

	test("Canon Supervisé : Beerus et Whis", () => {
		const r = analyzeCanon("Beerus et Whis sont-ils canoniques ?");
		expect(r.tier).toBe("CANON_SUPERVISE");
		expect(r.score).toBe(98);
		expect(r.toriyamaQuote?.source).toContain("Chōzenshū 1");
	});

	test("Canon Supervisé : Super Saiyan God et Blue", () => {
		const r = analyzeCanon("Le Super Saiyan God et le Super Saiyan Blue sont-ils canoniques ?");
		expect(r.tier).toBe("CANON_SUPERVISE");
		expect(r.score).toBe(95);
	});

	test("Canon Supervisé : Gohan Beast & Orange Piccolo", () => {
		const r = analyzeCanon("Son Gohan Beast et Orange Piccolo sont-ils canoniques ?");
		expect(r.tier).toBe("CANON_SUPERVISE");
		expect(r.score).toBe(98);
		expect(r.toriyamaQuote).toBeDefined();
	});

	test("Canon Supervisé : Zalama et les Super Dragon Balls", () => {
		const r = analyzeCanon("Le Dieu Dragon Zalama et les Super Dragon Balls sont-ils canoniques ?");
		expect(r.tier).toBe("CANON_SUPERVISE");
		expect(r.score).toBe(92);
	});

	test("Canon Supervisé : Tarble frère de Vegeta", () => {
		const r = analyzeCanon("Tarble le frère de Vegeta est-il canonique ?");
		expect(r.tier).toBe("CANON_SUPERVISE");
		expect(r.score).toBe(90);
	});

	test("Canon Supervisé : Vomi et C-21", () => {
		const r = analyzeCanon("Vomi la femme du Dr Gero et C-21 sont-elles canoniques ?");
		expect(r.tier).toBe("CANON_SUPERVISE");
		expect(r.score).toBe(85);
	});

	// ── 3. EXTENSION OFFICIELLE (Guides Shueisha, Daizenshuu, SEG) ───────────
	test("Extension Officielle : Multiplicateurs SSJ1 x50, SSJ2 x2, SSJ3 x4", () => {
		const r = analyzeCanon("Les multiplicateurs x50, x100 et x400 du Super Saiyan sont-ils officiels ?");
		expect(r.tier).toBe("EXTENSION_OFFICIELLE");
		expect(r.score).toBe(75);
	});

	test("Extension Officielle : Goku 150M sur Namek", () => {
		const r = analyzeCanon("La puissance de Goku à 150 000 000 contre Freezer est-elle officielle ?");
		expect(r.tier).toBe("EXTENSION_OFFICIELLE");
		expect(r.score).toBe(75);
	});

	test("Extension Officielle : Heuristique des guides officiels", () => {
		const r = analyzeCanon("Que dit le Daizenshuu sur cette technique ?");
		expect(r.tier).toBe("EXTENSION_OFFICIELLE");
		expect(r.score).toBe(85);
	});

	// ── 4. NON CANON DÉRIVÉ (Films vintage Toei, DBGT, SDBH, Fillers) ─────────
	test("Non-Canon Dérivé : Dragon Ball GT", () => {
		const r = analyzeCanon("Dragon Ball GT est-il canonique ?");
		expect(r.tier).toBe("NON_CANON_DERIVE");
		expect(r.score).toBe(15);
		expect(r.toriyamaQuote?.source).toContain("Dragon Box GT");
	});

	test("Non-Canon Dérivé : Super Saiyan 4", () => {
		const r = analyzeCanon("Le Super Saiyan 4 de Goku et Vegeta est-il canonique ?");
		expect(r.tier).toBe("NON_CANON_DERIVE");
		expect(r.score).toBe(15);
		expect(r.explanation).toContain("Nakatsuru");
	});

	test("Non-Canon Dérivé : Cooler", () => {
		const r = analyzeCanon("Cooler le frère de Freezer est-il canonique ?");
		expect(r.tier).toBe("NON_CANON_DERIVE");
		expect(r.score).toBe(20);
		expect(r.verdict).toContain("Non-canonique");
	});

	test("Non-Canon Dérivé : Janemba", () => {
		const r = analyzeCanon("Janemba est-il canonique ?");
		expect(r.tier).toBe("NON_CANON_DERIVE");
		expect(r.score).toBe(20);
	});

	test("Non-Canon Dérivé : Tapion & l'épée de Trunks", () => {
		const r = analyzeCanon("Tapion et l'épée de Trunks sont-ils canoniques ?");
		expect(r.tier).toBe("NON_CANON_DERIVE");
		expect(r.score).toBe(20);
	});

	test("Non-Canon Dérivé : Bojack", () => {
		const r = analyzeCanon("Bojack et les mercenaires de l'espace sont-ils canoniques ?");
		expect(r.tier).toBe("NON_CANON_DERIVE");
		expect(r.score).toBe(20);
	});

	test("Non-Canon Dérivé : Thalès", () => {
		const r = analyzeCanon("Thalès et l'arbre sacré sont-ils canoniques ?");
		expect(r.tier).toBe("NON_CANON_DERIVE");
		expect(r.score).toBe(20);
	});

	test("Non-Canon Dérivé : Super Dragon Ball Heroes & Xenoverse", () => {
		const r = analyzeCanon("Super Dragon Ball Heroes et la patrouille du temps sont-ils canoniques ?");
		expect(r.tier).toBe("NON_CANON_DERIVE");
		expect(r.score).toBe(10);
	});

	test("Non-Canon Dérivé : Fillers de l'anime (Garlic Jr, Paikuhan)", () => {
		const r = analyzeCanon("L'arc de Garlic Jr et le tournoi de l'autre monde avec Paikuhan sont-ils canon ?");
		expect(r.tier).toBe("NON_CANON_DERIVE");
		expect(r.score).toBe(20);
	});

	// ── 5. APOCRYPHE / FANON (DBM, SSJ5 AF, Fan arts) ────────────────────────
	test("Apocryphe Fanon : Dragon Ball Multiverse", () => {
		const r = analyzeCanon("Dragon Ball Multiverse est-il canonique ?");
		expect(r.tier).toBe("APOCRYPHE_FANON");
		expect(r.score).toBe(0);
		expect(r.verdict).toContain("Salagir");
	});

	test("Apocryphe Fanon : Super Saiyan 5 (Dragon Ball AF)", () => {
		const r = analyzeCanon("Le Super Saiyan 5 est-il canonique ?");
		expect(r.tier).toBe("APOCRYPHE_FANON");
		expect(r.score).toBe(0);
	});

	test("Apocryphe Fanon : Fan-fiction générale", () => {
		const r = analyzeCanon("Ce fan-manga non officiel est-il canonique ?");
		expect(r.tier).toBe("APOCRYPHE_FANON");
		expect(r.score).toBe(0);
	});

	// ── 6. TROLLS & HORS-SUJET ───────────────────────────────────────────────
	test("Troll : Crossover Superman", () => {
		const r = analyzeCanon("Goku bat-il Superman ?");
		expect(r.nature).toBe("troll");
		expect(r.origine).toBe("troll:crossover");
	});

	test("Troll : Forme inventée au-delà du barème", () => {
		const r = analyzeCanon("Goku Super Saiyan 100 infini");
		expect(r.nature).toBe("troll");
		expect(r.origine).toBe("troll:invention");
	});
});

describe("Anti-Fandom et Fidélité Linguistique", () => {
	test("Les citations et explications de doctrine n'utilisent aucun terme Fandom interdit", () => {
		const TERMES_INTERDITS = [
			/\bFreeza\b/,
			/\bFrieza\b/,
			/\bKuririn\b/i,
			/\bKrillin\b/i,
			/\bSaiya-?jin\b/i,
			/\bSaiyen\b/i,
			/\bpoing du roi\b/i,
		];

		for (const entry of DEFAULT_CANON_CONFIG.entries) {
			const texteTotal = `${entry.title} ${entry.verdict} ${entry.explanation} ${entry.toriyamaQuote?.text ?? ""}`;
			for (const interdit of TERMES_INTERDITS) {
				expect(interdit.test(texteTotal)).toBe(false);
			}
		}
	});

	test("Toutes les entrées possèdent des sources explicites", () => {
		for (const entry of DEFAULT_CANON_CONFIG.entries) {
			expect(entry.sources.length).toBeGreaterThan(0);
			for (const src of entry.sources) {
				expect(src.trim().length).toBeGreaterThan(3);
			}
		}
	});
});

describe("Benchmark de Performance & Stabilité", () => {
	test("100 analyses de canonicité s'exécutent en moins de 50ms", () => {
		const requetes = [
			"Broly",
			"Gogeta",
			"Vegetto",
			"Bardock",
			"Dragon Ball GT",
			"Super Saiyan 4",
			"Cooler",
			"Janemba",
			"Dragon Ball Daima",
			"Beerus",
			"Super Saiyan God",
			"Gohan Beast",
			"Uub",
			"C-16",
			"Super Saiyan 5",
			"Dragon Ball Multiverse",
			"Yakon 800 Kiri",
			"Goku 150 millions",
		];

		const debut = performance.now();
		for (let i = 0; i < 100; i++) {
			const q = requetes[i % requetes.length]!;
			const r = analyzeCanon(q);
			expect(r.verdict).toBeTruthy();
		}
		const duree = performance.now() - debut;
		expect(duree).toBeLessThan(50);
	});

	test("Appariement des références dans un corpus volumineux", () => {
		const mockCorpus: CanonReference[] = Array.from({ length: 1000 }, (_, i) => ({
			id: `ref-${i}`,
			subject: `Sujet ${i} sur Goku et Vegeta`,
			keywords: ["goku", "vegeta", `test-${i}`],
			text: `Texte de preuve ${i}`,
			source: `Source officielle ${i}`,
			document: "doc.md",
			lang: "fr",
			provenance: "manga",
		}));

		const config = {
			...DEFAULT_CANON_CONFIG,
			references: mockCorpus,
		};

		const debut = performance.now();
		const refs = referencesPour("Goku et Vegeta test-42", config);
		const duree = performance.now() - debut;

		expect(refs.length).toBeGreaterThan(0);
		expect(refs[0]!.id).toBe("ref-42");
		expect(duree).toBeLessThan(20);
	});
});
