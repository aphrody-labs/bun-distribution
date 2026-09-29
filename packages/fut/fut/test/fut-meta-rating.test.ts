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
import {
	calculateFactualMetaRating,
	type DetailedCardStats,
} from "../src/squad/metaRating.ts";

describe("Factual Meta Rating Engine (FC 27)", () => {
	it("correctly identifies god-tier meta cards like Mbappé", () => {
		const mbappe: DetailedCardStats = {
			id: "mbappe",
			name: "Kylian Mbappé",
			overallRating: 91,
			position: "ST",
			pac: 97,
			sho: 90,
			pas: 80,
			dri: 92,
			def: 36,
			phy: 78,
			finishing: 94,
			shotPower: 90,
			sprintSpeed: 97,
			acceleration: 97,
			composure: 88,
			reactions: 93,
			skillMoves: 5,
			weakFoot: 4,
			accelerateType: "Controlled",
			bodyType: "Unique",
			playstylesPlus: ["Quick Step+"],
			playstyles: ["Rapid", "Finesse Shot"],
		};

		const report = calculateFactualMetaRating(mbappe);
		expect(report.factualMetaRating).toBeGreaterThanOrEqual(95);
		expect(report.tier).toBe("S+");
		expect(report.metaDelta).toBeGreaterThan(0);
		expect(report.strengths).toContain("5★ Gestes Techniques");
	});

	it("accurately elevates low-rated meta beasts like Ferland Mendy", () => {
		const mendy: DetailedCardStats = {
			id: "mendy",
			name: "Ferland Mendy",
			overallRating: 82,
			position: "LB",
			pac: 91,
			sho: 64,
			pas: 75,
			dri: 78,
			def: 81,
			phy: 86,
			sprintSpeed: 92,
			acceleration: 90,
			standingTackle: 83,
			interceptions: 80,
			stamina: 88,
			strength: 86,
			skillMoves: 4,
			weakFoot: 5,
			accelerateType: "Mostly Lengthy",
			bodyType: "Stocky",
			playstylesPlus: ["Quick Step+"],
			playstyles: ["Bruiser", "Anticipate"],
		};

		const report = calculateFactualMetaRating(mendy);
		// Plays like a 90+ rated fullback
		expect(report.factualMetaRating).toBeGreaterThanOrEqual(88);
		expect(report.tier).toBe("S");
		expect(report.metaDelta).toBeGreaterThan(6);
		expect(report.strengths).toContain("5★ Mauvais Pied (finition des deux pieds)");
	});

	it("penalizes high-rated unplayable fodder with low pace & stamina", () => {
		const slowMidfielder: DetailedCardStats = {
			id: "fodder-cm",
			name: "Slow Legend 88",
			overallRating: 88,
			position: "CM",
			pac: 52,
			sho: 80,
			pas: 91,
			dri: 81,
			def: 68,
			phy: 65,
			sprintSpeed: 50,
			acceleration: 54,
			stamina: 66,
			composure: 89,
			reactions: 88,
			skillMoves: 3,
			weakFoot: 4,
			accelerateType: "Controlled",
			bodyType: "Average",
		};

		const report = calculateFactualMetaRating(slowMidfielder);
		expect(report.factualMetaRating).toBeLessThan(80);
		expect(report.tier).toBe("C");
		expect(report.metaDelta).toBeLessThan(-8);
	});

	it("recommends optimal chemistry styles depending on positional gaps", () => {
		const strikerWithGoodPace: DetailedCardStats = {
			id: "haaland",
			name: "Erling Haaland",
			overallRating: 91,
			position: "ST",
			pac: 89,
			sho: 93,
			pas: 68,
			dri: 81,
			def: 45,
			phy: 88,
			skillMoves: 3,
			weakFoot: 3,
		};

		const report = calculateFactualMetaRating(strikerWithGoodPace);
		expect(report.recommendedChemStyle).toBe("Hunter");
	});
});
