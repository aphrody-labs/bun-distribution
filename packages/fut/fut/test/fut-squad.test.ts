/**
 * Copyright 2026 aphrody-code
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, expect, it } from "bun:test";
import { hasFutDataset } from "./helpers/fut-dataset.ts";
import {
	getFormation,
	listFormations,
	isPlayerInPosition,
	Squad,
	getEaFormation,
	listEaFormations,
	THRESHOLDS,
	thresholdsFromEaProfiles,
	SquadSolver,
	renderAsciiPitch,
	renderSvgPitch,
	type SquadPlayerItem,
} from "../src/squad/index.ts";

describe("EA SPORTS FC 27 Squad Builder Engine", () => {
	it("lists all supported formations including 4-4-2, 4-4-1-1, and 4-2-1-3", () => {
		const formations = listFormations();
		expect(formations).toContain("4-4-2");
		expect(formations).toContain("4-4-1-1");
		expect(formations).toContain("4-2-1-3");
		expect(formations).toContain("4-3-3");
		expect(formations.length).toBeGreaterThanOrEqual(7);

		const f4411 = getFormation("4-4-1-1");
		expect(f4411.slots.length).toBe(11);
		expect(f4411.slots[0].defaultPosition).toBe("GK");
		expect(f4411.slots[10].defaultPosition).toBe("ST");
	});

	it("accurately detects in-position vs out-of-position players", () => {
		const mbappe: SquadPlayerItem = {
			id: "mbappe",
			name: "Kylian Mbappé",
			rating: 91,
			primaryPosition: "ST",
			alternativePositions: ["LW", "CF"],
			club: "Real Madrid",
			league: "LALIGA EA SPORTS",
			nation: "France",
		};

		expect(isPlayerInPosition(mbappe, "ST", ["ST", "CF"])).toBe(true);
		expect(isPlayerInPosition(mbappe, "LW", ["LW", "LM"])).toBe(true);
		expect(isPlayerInPosition(mbappe, "CB", ["CB"])).toBe(false);
	});

	it("computes chemistry correctly with club, nation and league links", () => {
		const squad = Squad.create("4-4-2");

		const courtois: SquadPlayerItem = {
			id: "courtois",
			name: "Thibaut Courtois",
			rating: 90,
			primaryPosition: "GK",
			alternativePositions: [],
			club: "Real Madrid",
			league: "LALIGA EA SPORTS",
			nation: "Belgium",
		};

		const rudiger: SquadPlayerItem = {
			id: "rudiger",
			name: "Antonio Rüdiger",
			rating: 85,
			primaryPosition: "CB",
			alternativePositions: [],
			club: "Real Madrid",
			league: "LALIGA EA SPORTS",
			nation: "Germany",
		};

		squad.setPlayer(0, courtois);
		squad.setPlayer(2, rudiger);

		const chem = squad.getChemistry();
		// 2 players from Real Madrid -> 1 club chem point each
		expect(chem.clubs["Real Madrid"]?.count).toBe(2);
		expect(chem.clubs["Real Madrid"]?.points).toBe(1);

		const breakdownCourtois = chem.playerBreakdowns.find((p) => p.slotIndex === 0);
		expect(breakdownCourtois?.clubPoints).toBe(1);
	});

	it("awards full 3 chemistry to Icons in position and grants league contributions", () => {
		const squad = Squad.create("4-4-2");

		const zidane: SquadPlayerItem = {
			id: "zidane",
			name: "Zinedine Zidane",
			rating: 94,
			primaryPosition: "CM",
			alternativePositions: ["CAM"],
			club: "Icons",
			league: "Icons",
			nation: "France",
			isIcon: true,
		};

		squad.setPlayer(6, zidane);
		const chem = squad.getChemistry();
		const zidaneBreakdown = chem.playerBreakdowns.find((p) => p.slotIndex === 6);
		expect(zidaneBreakdown?.totalPoints).toBe(3);
		expect(chem.nations["France"]?.count).toBe(2); // Icon nation boost
	});

	it("supports squad serialization and deserialization", () => {
		const squad = Squad.create("4-4-1-1");
		squad.setManager({ name: "Ancelotti", nation: "Italy", league: "LALIGA EA SPORTS" });

		const json = squad.toJSON();
		expect(json.formation).toBe("4-4-1-1");
		expect(json.manager?.name).toBe("Ancelotti");

		const restored = Squad.fromJSON(json);
		expect(restored.formation.name).toBe("4-4-1-1");
		expect(restored.manager?.name).toBe("Ancelotti");
	});

	it("renders clean ASCII pitch and valid SVG markup", () => {
		const squad = Squad.create("4-2-1-3");
		const ascii = renderAsciiPitch(squad);
		expect(ascii).toContain("EA SPORTS FC 27 SQUAD BUILDER");
		expect(ascii).toContain("FORMATION: 4-2-1-3");

		const svg = renderSvgPitch(squad);
		expect(svg).toContain("<svg");
		expect(svg).toContain("EA SPORTS FC 27 SQUAD BUILDER");
		expect(svg).toContain("FORMATION: 4-2-1-3");
		expect(svg).toContain("</svg>");
	});

	it.skipIf(!hasFutDataset)("solves squads autonomously using SQLite database", () => {
		const solver = new SquadSolver();
		const squad = solver.solve({
			formation: "4-4-2",
			maxBudget: 500000,
			preferredLeagues: ["LALIGA EA SPORTS", "Liga F"],
		});

		const stats = squad.getStats();
		const chem = squad.getChemistry();

		expect(squad.formation.name).toBe("4-4-2");
		expect(stats.squadRating).toBeGreaterThanOrEqual(85);
		expect(chem.totalChemistry).toBeGreaterThanOrEqual(25);
		expect(squad.substitutes.length).toBe(7);
		expect(squad.reserves.length).toBe(5);
	});
});

describe("Chemistry thresholds from EA profiles", () => {
	it("uses EA live ladders when the payload provides them", () => {
		const t = thresholdsFromEaProfiles({
			profiles: [{ clubThresholds: [3, 5, 9], leagueThresholds: [4, 6, 9], nationThresholds: [3, 6, 9] }],
		});
		expect(t.CLUB).toEqual([3, 5, 9]);
		expect(t.LEAGUE).toEqual([4, 6, 9]);
		expect(t.NATION).toEqual([3, 6, 9]);
	});

	it("falls back to the defaults for ladders EA omits", () => {
		const t = thresholdsFromEaProfiles({ profiles: [{ clubThresholds: [3, 5, 9] }] });
		expect(t.CLUB).toEqual([3, 5, 9]);
		expect(t.NATION).toEqual(THRESHOLDS.NATION);
		expect(t.LEAGUE).toEqual(THRESHOLDS.LEAGUE);
	});

	it("ignores malformed ladders and keeps the defaults", () => {
		const t = thresholdsFromEaProfiles({ profiles: [{ clubThresholds: [1, 2] }] });
		expect(t.CLUB).toEqual(THRESHOLDS.CLUB);
	});

	it("survives an empty payload", () => {
		const t = thresholdsFromEaProfiles({});
		expect(t.CLUB).toEqual(THRESHOLDS.CLUB);
	});
});

describe("EA formations (the game's own 29 layouts)", () => {
	it("exposes every formation EA ships, not just the hand-written ones", () => {
		expect(listEaFormations()).toHaveLength(29);
		// The tuned catalogue used to cap the package at 7.
		expect(listFormations().length).toBeGreaterThanOrEqual(29);
	});

	it("decodes known layouts exactly", () => {
		// Read EA's data directly: getFormation() prefers the tuned catalogue,
		// which orders some slots differently (RW LW ST rather than RW ST LW).
		const layout = (n: string) =>
			getEaFormation(n)!.slots.map((s) => s.defaultPosition).join(" ");
		expect(layout("4-3-3")).toBe("GK RB CB CB LB CM CM CM RW ST LW");
		expect(layout("4-4-2")).toBe("GK RB CB CB LB RM CM CM LM ST ST");
		expect(layout("3-5-2")).toBe("GK CB CB CB CDM CDM RM LM CAM ST ST");
		expect(layout("4-2-3-1")).toBe("GK RB CB CB LB CDM CDM CAM CAM CAM ST");
	});

	it("keeps same-named variants distinct", () => {
		const base = getFormation("4-3-3").slots.map((s) => s.defaultPosition);
		const variant = getFormation("4-3-3 (2)").slots.map((s) => s.defaultPosition);
		expect(variant).not.toEqual(base);
		expect(variant).toContain("CDM");
	});

	it("gives every formation eleven slots and a coherent category", () => {
		for (const name of listEaFormations()) {
			const f = getEaFormation(name);
			expect(f, name).toBeDefined();
			expect(f?.slots, name).toHaveLength(11);
			expect(f?.slots[0].defaultPosition, name).toBe("GK");
			const defenders = f!.slots.filter((s) =>
				["CB", "RB", "LB", "RWB", "LWB"].includes(s.defaultPosition),
			).length;
			if (f!.category === "5-at-the-back") expect(defenders, name).toBeGreaterThanOrEqual(5);
			if (f!.category === "3-at-the-back") expect(defenders, name).toBeLessThanOrEqual(3);
		}
	});

	it("prefers the tuned catalogue when it has the formation", () => {
		// 4-4-1-1 is hand-written with tuned coordinates; they must survive.
		expect(getFormation("4-4-1-1").slots[1].coordinates).toEqual({ x: 88, y: 72 });
	});

	it("resolves names case-insensitively and rejects unknown ones", () => {
		expect(getEaFormation("4-3-3")).toBeDefined();
		expect(getEaFormation("  4-3-3  ")).toBeDefined();
		expect(getEaFormation("9-0-1")).toBeUndefined();
		expect(() => getFormation("9-0-1")).toThrow(/Unknown formation/);
	});
});
