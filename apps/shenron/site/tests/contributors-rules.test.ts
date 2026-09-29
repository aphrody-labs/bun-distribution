import { describe, expect, test } from "bun:test";
import { detectCheatSignals } from "../src/lib/contributors-rules";

const at = (ms: number) => new Date(1_700_000_000_000 + ms).toISOString();
const codes = (s: ReturnType<typeof detectCheatSignals>) => s.map((x) => x.code);

describe("detectCheatSignals", () => {
	test("aucune note : aucun signal", () => {
		expect(detectCheatSignals([])).toEqual([]);
	});

	test("activité humaine variée : aucun signal", () => {
		const ratings = Array.from({ length: 40 }, (_, i) => ({
			score: (i % 5) + 1,
			comment: `Avis détaillé numéro ${i} sur cet épisode`,
			createdAt: at(i * 6 * 3_600_000),
		}));
		expect(detectCheatSignals(ratings)).toEqual([]);
	});

	test("200 notes en dix minutes : rafale et cadence", () => {
		const ratings = Array.from({ length: 200 }, (_, i) => ({
			score: (i % 5) + 1,
			comment: `Avis unique ${i} écrit à la main`,
			createdAt: at(i * 3_000),
		}));
		const found = codes(detectCheatSignals(ratings));
		expect(found).toContain("burst");
		expect(found).toContain("cadence");
	});

	test("scores plats et notes sans avis", () => {
		const ratings = Array.from({ length: 40 }, (_, i) => ({
			score: 5,
			comment: null,
			createdAt: at(i * 4 * 3_600_000),
		}));
		const found = codes(detectCheatSignals(ratings));
		expect(found).toContain("flat-scores");
		expect(found).toContain("no-comment");
		// Étalé sur une semaine : ni rafale ni cadence machine.
		expect(found).not.toContain("burst");
		expect(found).not.toContain("cadence");
	});

	test("texte recyclé détecté à partir de trois occurrences", () => {
		const ratings = Array.from({ length: 3 }, (_, i) => ({
			score: i + 1,
			comment: "Vraiment un très bon épisode",
			createdAt: at(i * 86_400_000),
		}));
		const signal = detectCheatSignals(ratings).find((s) => s.code === "duplicate-text");
		expect(signal).toBeDefined();
		expect(signal?.detail).toContain("3 fois");
	});

	test("avis squelettiques", () => {
		const ratings = Array.from({ length: 12 }, (_, i) => ({
			score: (i % 5) + 1,
			comment: i % 12 === 0 ? "Un avis un peu plus long" : `ok${i}`,
			createdAt: at(i * 86_400_000),
		}));
		expect(codes(detectCheatSignals(ratings))).toContain("short-text");
	});

	test("les commentaires de fil comptent dans les doublons", () => {
		const ratings = [{ score: 4, comment: "bravo à tous", createdAt: at(0) }];
		const comments = [
			{ body: "bravo à tous", createdAt: at(1000) },
			{ body: "Bravo à tous", createdAt: at(2000) },
		];
		expect(codes(detectCheatSignals(ratings, comments))).toContain("duplicate-text");
	});
});

/**
 * Gardes d'intégration : le registre du concours touche à des données de
 * modération (commentaires masqués/supprimés) et à un écran staff. Ces tests
 * lisent les sources — les modules concernés ouvrent Postgres à l'import.
 */
const contributors = await Bun.file(new URL("../src/lib/contributors.ts", import.meta.url)).text();
const profil = await Bun.file(
	new URL("../src/app/profil/[id]/page.tsx", import.meta.url)
).text();
const adminConcours = await Bun.file(
	new URL("../src/app/admin/concours/page.tsx", import.meta.url)
).text();
const ledger = await Bun.file(
	new URL("../src/components/contest/MemberLedger.tsx", import.meta.url)
).text();

describe("registre du concours", () => {
	test("hors staff, les commentaires supprimés ne sortent pas de la base", () => {
		expect(contributors).toContain("viewerIsAdmin ? undefined : sql`${contentComments.status}");
		expect(contributors).toContain("HIDDEN_COMMENT_BODY : c.body");
	});

	test("le profil public ne demande ni vue staff ni signaux d'intégrité", () => {
		expect(profil).toContain("getMemberContributions(id, { limit: 200 })");
		expect(profil).not.toContain("viewerIsAdmin");
		expect(profil).not.toContain("showSignals");
	});

	test("l'écran d'arbitrage est gaté par requireAdmin avant toute lecture", () => {
		const gate = adminConcours.indexOf("await requireAdmin()");
		const read = adminConcours.indexOf("getTopRaters(");
		expect(gate).toBeGreaterThan(-1);
		expect(read).toBeGreaterThan(gate);
		expect(adminConcours).toContain("viewerIsAdmin: true");
		expect(adminConcours).toContain("showSignals");
	});

	test("les signaux ne s'affichent que sur demande explicite", () => {
		expect(ledger).toContain("showSignals = false");
		expect(ledger).toContain("{showSignals && (");
	});

	test("le classement écarte les comptes sans profil plutôt que de les anonymiser", () => {
		expect(contributors).toContain("if (!p) return []");
	});
});
