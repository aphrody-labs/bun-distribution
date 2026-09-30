/**
 * Chronologie universelle — résolution de la curation et tri.
 *
 * `applyChronology` traduit la curation admin (ordre, ère, date, masquage,
 * notes) en la liste que le public voit sur `/wiki/chronologie`. Elle n'avait
 * aucun test alors que toute la page dépend de sa sortie. Module client-safe
 * (aucun import serveur), donc testable directement.
 */
import { describe, expect, test } from "bun:test";
import {
	DEFAULT_CHRONOLOGY_CONFIG,
	applyChronology,
	compareTimeline,
	eraOf,
	resolveChronologyConfig,
	timelineKey,
	type TimelineItem,
} from "../src/lib/chronology";

const ep = (id: number, over: Partial<TimelineItem> = {}): TimelineItem => ({
	kind: "episode",
	id,
	series: "DBZ",
	// `era` est portée par l'entrée elle-même (calculée par `dbUniverse.timeline()`
	// via `eraOf`), pas par `applyChronology` — qui ne fait que la surcharger si la
	// curation le demande.
	era: eraOf("DBZ"),
	number: id,
	title: `Épisode ${id}`,
	titleJa: null,
	date: 600_000_000 + id,
	image: null,
	hasVf: false,
	hasVostfr: true,
	href: `/wiki/episodes/${id}`,
	...over,
});

describe("resolveChronologyConfig", () => {
	test("un patch absent ou invalide retombe sur les défauts", () => {
		for (const bad of [null, undefined, 42, "x", []]) {
			const cfg = resolveChronologyConfig(bad);
			expect(cfg.version).toBe(1);
			expect(cfg.overrides).toEqual({});
			expect(cfg.eraOrder.length).toBe(DEFAULT_CHRONOLOGY_CONFIG.eraOrder.length);
		}
	});

	test("les ères inconnues sont ignorées et l'ordre est complété", () => {
		const cfg = resolveChronologyConfig({
			eraOrder: ["pas-une-ere", DEFAULT_CHRONOLOGY_CONFIG.eraOrder[2]],
		});
		expect(cfg.eraOrder).not.toContain("pas-une-ere");
		// Toutes les ères connues restent présentes, sans doublon.
		expect(new Set(cfg.eraOrder).size).toBe(cfg.eraOrder.length);
		expect(cfg.eraOrder.length).toBe(DEFAULT_CHRONOLOGY_CONFIG.eraOrder.length);
	});

	test("un override vide est éliminé, un override utile est conservé", () => {
		const cfg = resolveChronologyConfig({
			overrides: {
				"episode:1": {},
				"episode:2": { hidden: true },
				"episode:3": { titre: "faux champ" },
			},
		});
		expect(cfg.overrides["episode:1"]).toBeUndefined();
		expect(cfg.overrides["episode:2"]).toEqual({ hidden: true });
		expect(cfg.overrides["episode:3"]).toBeUndefined();
	});

	test("les chaînes sont bornées", () => {
		const cfg = resolveChronologyConfig({
			overrides: { "episode:1": { title: "x".repeat(500), note: "y".repeat(900) } },
		});
		expect(cfg.overrides["episode:1"]!.title!.length).toBe(300);
		expect(cfg.overrides["episode:1"]!.note!.length).toBe(600);
	});
});

describe("applyChronology", () => {
	test("sans curation, renvoie tout le dataset avec une ère résolue", () => {
		const out = applyChronology([ep(1), ep(2), ep(3)], DEFAULT_CHRONOLOGY_CONFIG);
		expect(out).toHaveLength(3);
		expect(out.every((i) => Boolean(i.era))).toBe(true);
	});

	test("une entrée masquée disparaît du public", () => {
		const items = [ep(1), ep(2)];
		const cfg = resolveChronologyConfig({
			overrides: { [timelineKey(items[1]!)]: { hidden: true } },
		});
		expect(applyChronology(items, cfg).map((i) => i.id)).toEqual([1]);
	});

	test("un titre surchargé remplace le titre de la base", () => {
		const items = [ep(1)];
		const cfg = resolveChronologyConfig({
			overrides: { [timelineKey(items[0]!)]: { title: "Titre officiel" } },
		});
		expect(applyChronology(items, cfg)[0]!.title).toBe("Titre officiel");
	});

	test("une ère surchargée remplace celle déduite de la série", () => {
		const items = [ep(1)];
		expect(items[0]!.era).toBe("DBZ");
		const cfg = resolveChronologyConfig({
			overrides: { [timelineKey(items[0]!)]: { era: "GT" } },
		});
		expect(applyChronology(items, cfg)[0]!.era).toBe("GT");
	});

	test("un dataset vide reste vide et ne lève pas", () => {
		expect(applyChronology([], DEFAULT_CHRONOLOGY_CONFIG)).toEqual([]);
	});

	test("`timelineKey` distingue deux natures partageant un id", () => {
		expect(timelineKey(ep(7))).not.toBe(timelineKey({ ...ep(7), kind: "movie" }));
	});
});

describe("compareTimeline", () => {
	test("tri par titre, alphabétique", () => {
		const items = [
			ep(3, { title: "Cellule" }),
			ep(1, { title: "Aube" }),
			ep(2, { title: "Bataille" }),
		];
		expect([...items].sort(compareTimeline("title")).map((i) => i.title)).toEqual([
			"Aube",
			"Bataille",
			"Cellule",
		]);
	});

	test("tri par date, les plus anciennes d'abord", () => {
		const items = [ep(3, { date: 300 }), ep(1, { date: 100 }), ep(2, { date: 200 })];
		expect([...items].sort(compareTimeline("date")).map((i) => i.date)).toEqual([100, 200, 300]);
	});
});
