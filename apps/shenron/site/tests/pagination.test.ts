import { describe, expect, test } from "bun:test";
import { pagesVisibles } from "@/components/ui/Pagination";

describe("pagesVisibles", () => {
	test("liste tout tant que ça tient (≤ 7 pages)", () => {
		expect(pagesVisibles(1, 1)).toEqual([1]);
		expect(pagesVisibles(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
	});

	test("garde toujours la première et la dernière page", () => {
		for (const page of [1, 5, 11]) {
			const vues = pagesVisibles(page, 11);
			expect(vues[0]).toBe(1);
			expect(vues[vues.length - 1]).toBe(11);
		}
	});

	test("place la page courante et ses voisines", () => {
		expect(pagesVisibles(6, 11)).toContain(5);
		expect(pagesVisibles(6, 11)).toContain(6);
		expect(pagesVisibles(6, 11)).toContain(7);
	});

	test("insère une ellipse dès qu'un numéro est sauté, jamais entre deux consécutifs", () => {
		const vues = pagesVisibles(6, 11);
		const numeros = vues.filter((n): n is number => n !== null);
		for (let i = 1; i < vues.length; i++) {
			const a = vues[i - 1];
			const b = vues[i];
			if (a !== null && b !== null) expect(b - a).toBe(1);
		}
		expect(vues).toContain(null);
		// 11 pages autour de la 6e : 1 … 5 6 7 … 11
		expect(numeros).toEqual([1, 5, 6, 7, 11]);
	});

	test("aux bords, la barre garde une largeur stable", () => {
		// Sans élargissement au bord, « page 1 » n'afficherait que 1 2 … 11.
		expect(pagesVisibles(1, 11)).toEqual([1, 2, 3, 4, null, 11]);
		expect(pagesVisibles(11, 11)).toEqual([1, null, 8, 9, 10, 11]);
	});

	test("ne sort jamais des bornes", () => {
		for (const total of [1, 2, 8, 40]) {
			for (let page = 1; page <= total; page++) {
				for (const n of pagesVisibles(page, total)) {
					if (n !== null) {
						expect(n).toBeGreaterThanOrEqual(1);
						expect(n).toBeLessThanOrEqual(total);
					}
				}
			}
		}
	});
});
