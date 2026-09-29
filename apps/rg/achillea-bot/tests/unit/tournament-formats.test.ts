/**
 * Tests des formats de tournoi (génération de bracket via brackets-manager).
 *
 * On valide que les 3 formats supportés produisent une structure cohérente, avec un
 * adaptateur CRUD in-memory (même contrat que MikroORMBracketAdapter) → aucune DB requise.
 * C'est ce qui garantit que le passage de `single_elimination`-only à multi-format est sain :
 * l'avancement (winner/loser bracket, round-robin) est entièrement délégué à brackets-manager.
 */
import { describe, expect, test } from "bun:test";
import { BracketsManager } from "brackets-manager";
import type { CrudInterface } from "brackets-manager";

import {
	BRACKET_TOURNAMENT_TYPES,
	isSupportedTournamentType,
} from "../../src/services/tournament-policies";
import { StageType } from "../../src/utils/enums";

// Adaptateur CRUD in-memory minimal : ids auto-incrémentés par table.
class InMemoryStorage implements CrudInterface {
	private store: Record<string, any[]> = {};
	private tbl(t: string): any[] {
		return (this.store[t] ??= []);
	}
	async insert(table: any, value: any): Promise<any> {
		const t = this.tbl(table);
		const rows = Array.isArray(value) ? value : [value];
		const ids = rows.map((v) => {
			const id = t.length;
			t.push({ id, ...v });
			return id;
		});
		return Array.isArray(value) ? true : ids[0];
	}
	async select(table: any, filter?: any): Promise<any> {
		const t = this.tbl(table);
		if (filter === undefined) return [...t];
		if (typeof filter === "number" || typeof filter === "string")
			return t.find((r) => r.id === filter) ?? null;
		const e = Object.entries(filter).filter(([, v]) => v !== undefined);
		return t.filter((r) => e.every(([k, v]) => r[k] === v));
	}
	async update(table: any, filter: any, value?: any): Promise<boolean> {
		const t = this.tbl(table);
		if (typeof filter === "number" || typeof filter === "string") {
			const r = t.find((x) => x.id === filter);
			if (!r) return false;
			Object.assign(r, value);
			return true;
		}
		const e = Object.entries(filter).filter(([, v]) => v !== undefined);
		const rows = t.filter((r) => e.every(([k, v]) => r[k] === v));
		rows.forEach((r) => Object.assign(r, value));
		return rows.length > 0;
	}
	async delete(table: any, filter?: any): Promise<boolean> {
		if (!filter) {
			this.store[table] = [];
			return true;
		}
		const t = this.tbl(table);
		const e = Object.entries(filter).filter(([, v]) => v !== undefined);
		this.store[table] = t.filter((r) => !e.every(([k, v]) => r[k] === v));
		return true;
	}
}

const SEED = ["A", "B", "C", "D"];

describe("formats de tournoi — gate", () => {
	test("les 3 formats brackets-manager sont supportés, pas le suisse", () => {
		expect(isSupportedTournamentType(StageType.single_elimination)).toBe(true);
		expect(isSupportedTournamentType(StageType.double_elimination)).toBe(true);
		expect(isSupportedTournamentType(StageType.round_robin)).toBe(true);
		expect(BRACKET_TOURNAMENT_TYPES).toHaveLength(3);
		expect(isSupportedTournamentType("swiss" as StageType)).toBe(false);
	});
});

describe("formats de tournoi — génération du bracket", () => {
	test("single_elimination : 4 joueurs → 1 groupe, 3 matchs", async () => {
		const m = new BracketsManager(new InMemoryStorage());
		await m.create.stage({
			tournamentId: 0,
			name: "SE",
			type: StageType.single_elimination,
			seeding: SEED,
			settings: { seedOrdering: ["inner_outer"] },
		});
		expect((await m.storage.select("group")).length).toBe(1);
		expect((await m.storage.select("match")).length).toBe(3);
	});

	test("double_elimination : 4 joueurs → winner + loser bracket (≥2 groupes, >3 matchs)", async () => {
		const m = new BracketsManager(new InMemoryStorage());
		await m.create.stage({
			tournamentId: 0,
			name: "DE",
			type: StageType.double_elimination,
			seeding: SEED,
			settings: { seedOrdering: ["inner_outer"] },
		});
		expect((await m.storage.select("group")).length).toBeGreaterThanOrEqual(2);
		expect((await m.storage.select("match")).length).toBeGreaterThan(3);
	});

	test("round_robin : 4 joueurs → 6 matchs (tout le monde s'affronte)", async () => {
		const m = new BracketsManager(new InMemoryStorage());
		await m.create.stage({
			tournamentId: 0,
			name: "RR",
			type: StageType.round_robin,
			seeding: SEED,
			settings: { groupCount: 1 },
		});
		expect((await m.storage.select("match")).length).toBe(6);
	});
});
