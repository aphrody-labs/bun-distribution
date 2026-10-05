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

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getFormation } from "./formations.ts";
import { isPlayerInPosition } from "./chemistry.ts";
import { Squad } from "./squad.ts";
import type { PitchPosition, SquadPlayerItem } from "./types.ts";

export interface SolverOptions {
	formation?: string;
	maxBudget?: number;
	preferredLeagues?: string[];
	preferredNations?: string[];
	preferredPlaystyles?: string[];
	requiredPlayerNames?: string[];
	minRating?: number;
	dbPath?: string;
}

function estimatePlayerPrice(rating: number, rarity?: string): number {
	const isIcon = rarity?.toLowerCase().includes("icon") ?? false;
	const isHero = rarity?.toLowerCase().includes("hero") ?? false;

	if (isIcon) {
		if (rating >= 93) return 1_500_000;
		if (rating >= 91) return 800_000;
		return 350_000;
	}

	if (isHero) {
		if (rating >= 89) return 400_000;
		return 120_000;
	}

	if (rating >= 91) return 250_000;
	if (rating >= 90) return 90_000;
	if (rating >= 89) return 45_000;
	if (rating >= 88) return 22_000;
	if (rating >= 87) return 12_000;
	if (rating >= 86) return 8_000;
	if (rating >= 85) return 4_500;
	if (rating >= 84) return 2_500;
	if (rating >= 83) return 1_200;
	if (rating >= 82) return 850;
	return 700;
}

export class SquadSolver {
	private db: Database | null = null;

	constructor(customDbPath?: string) {
		const defaultPath = join(import.meta.dir, "../data/fut_extracted_database.sqlite");
		const dbPath = customDbPath ?? defaultPath;
		if (existsSync(dbPath)) {
			this.db = new Database(dbPath, { readonly: true });
		}
	}

	public findPlayers(filter: {
		position?: string;
		minRating?: number;
		maxRating?: number;
		leagues?: string[];
		nations?: string[];
		requiredName?: string;
		limit?: number;
	}): SquadPlayerItem[] {
		if (!this.db) return [];

		const clauses: string[] = ["1=1"];
		const params: Record<string, unknown> = {};

		if (filter.requiredName) {
			clauses.push("name LIKE $name");
			params["$name"] = `%${filter.requiredName}%`;
		}

		if (filter.position) {
			clauses.push("(position = $pos OR alternative_positions LIKE $posAlt)");
			params["$pos"] = filter.position;
			params["$posAlt"] = `%${filter.position}%`;
		}

		if (filter.minRating) {
			clauses.push("rating >= $minRating");
			params["$minRating"] = filter.minRating;
		}

		if (filter.maxRating) {
			clauses.push("rating <= $maxRating");
			params["$maxRating"] = filter.maxRating;
		}

		if (filter.leagues && filter.leagues.length > 0) {
			const placeholders = filter.leagues.map((_, i) => `$lg${i}`).join(",");
			clauses.push(`league IN (${placeholders})`);
			filter.leagues.forEach((l, i) => {
				params[`$lg${i}`] = l;
			});
		}

		const sql = `
			SELECT id, name, rating, position, club, nation, league, rarity,
			       pac, sho, pas, dri, def, phy, skill_moves, weak_foot, foot,
			       accelerate_type, alternative_positions, playstyles
			FROM players
			WHERE ${clauses.join(" AND ")}
			ORDER BY rating DESC
			LIMIT ${filter.limit ?? 25};
		`;

		try {
			const rows = this.db.query(sql).all(params as any) as any[];
			return rows.map((r) => {
				let playstyles: string[] = [];
				try {
					playstyles = r.playstyles ? JSON.parse(r.playstyles) : [];
				} catch {
					playstyles = [];
				}

				const isIcon = (r.rarity?.toLowerCase().includes("icon") ?? false) || r.league === "Icons";
				const isHero = (r.rarity?.toLowerCase().includes("hero") ?? false) || r.league === "Heroes";

				const estimatedPrice = estimatePlayerPrice(r.rating, r.rarity);

				let alternativePositions: PitchPosition[] = [];
				if (r.alternative_positions) {
					try {
						const parsed = JSON.parse(r.alternative_positions);
						if (Array.isArray(parsed)) {
							alternativePositions = parsed as PitchPosition[];
						}
					} catch {
						alternativePositions = r.alternative_positions
							.split(",")
							.map((s: string) => s.trim().replace(/^["'[\]]+|["'[\]]+$/g, ""))
							.filter(Boolean) as PitchPosition[];
					}
				}

				return {
					id: r.id,
					name: r.name,
					rating: r.rating,
					primaryPosition: r.position as PitchPosition,
					alternativePositions,
					club: r.club ?? "",
					nation: r.nation ?? "",
					league: r.league ?? "",
					rarity: r.rarity ?? "",
					isIcon,
					isHero,
					pac: r.pac ?? 0,
					sho: r.sho ?? 0,
					pas: r.pas ?? 0,
					dri: r.dri ?? 0,
					def: r.def ?? 0,
					phy: r.phy ?? 0,
					skillMoves: r.skill_moves ?? 3,
					weakFoot: r.weak_foot ?? 3,
					foot: r.foot === "Left" ? "Left" : "Right",
					accelerateType: r.accelerate_type ?? "Controlled",
					playstyles,
					priceConsole: estimatedPrice,
					pricePc: estimatedPrice,
				};
			});
		} catch (err) {
			console.error("Failed to query players for solver:", err);
			return [];
		}
	}

	public solve(options: SolverOptions = {}): Squad {
		const formationName = options.formation ?? "4-4-2";
		const formation = getFormation(formationName);
		const squad = Squad.create(formationName);

		const maxBudget = options.maxBudget ?? 1_000_000;
		const leagues = options.preferredLeagues ?? ["LALIGA EA SPORTS", "Liga F", "Premier League"];
		const minRating = options.minRating ?? (maxBudget <= 150_000 ? 82 : maxBudget <= 1_000_000 ? 85 : 88);

		const pickedPlayerIds = new Set<string>();

		// 1. Fill required players if specified
		if (options.requiredPlayerNames) {
			for (const name of options.requiredPlayerNames) {
				const matches = this.findPlayers({ requiredName: name, limit: 1 });
				if (matches.length > 0) {
					const player = matches[0];
					// Find suitable slot
					for (const slot of formation.slots) {
						if (!squad.starters.get(slot.slotIndex)?.player && slot.allowedPositions.includes(player.primaryPosition)) {
							squad.setPlayer(slot.slotIndex, player);
							pickedPlayerIds.add(player.id);
							break;
						}
					}
				}
			}
		}

		// 2. Fill empty starter slots
		for (const slot of formation.slots) {
			if (squad.starters.get(slot.slotIndex)?.player) continue;

			// Search candidates matching slot position and preferred leagues
			let candidates = this.findPlayers({
				position: slot.defaultPosition,
				minRating,
				leagues,
				limit: 20,
			});

			// If no candidate with preferred leagues, expand search
			if (candidates.length === 0) {
				candidates = this.findPlayers({
					position: slot.defaultPosition,
					minRating: Math.max(78, minRating - 3),
					limit: 20,
				});
			}

			// Filter out already picked players and ensure player is in position
			const available = candidates.filter(
				(c) =>
					!pickedPlayerIds.has(c.id) &&
					isPlayerInPosition(c, slot.defaultPosition, slot.allowedPositions),
			);
			if (available.length > 0) {
				const chosen = available[0];
				squad.setPlayer(slot.slotIndex, chosen);
				pickedPlayerIds.add(chosen.id);
			}
		}

		// 3. Fill 7 substitutes
		const subPositions: PitchPosition[] = ["ST", "RW", "LW", "CM", "CDM", "CB", "GK"];
		for (const pos of subPositions) {
			const candidates = this.findPlayers({ position: pos, minRating: Math.max(80, minRating - 2), limit: 10 });
			const available = candidates.filter((c) => !pickedPlayerIds.has(c.id));
			if (available.length > 0) {
				const sub = available[0];
				squad.addSubstitute(sub);
				pickedPlayerIds.add(sub.id);
			}
		}

		// 4. Fill 5 reserves
		const reservePositions: PitchPosition[] = ["CAM", "LB", "RB", "ST", "CM"];
		for (const pos of reservePositions) {
			const candidates = this.findPlayers({ position: pos, minRating: Math.max(78, minRating - 4), limit: 10 });
			const available = candidates.filter((c) => !pickedPlayerIds.has(c.id));
			if (available.length > 0) {
				const res = available[0];
				squad.addReserve(res);
				pickedPlayerIds.add(res.id);
			}
		}

		// 5. Manager
		squad.setManager({
			name: "Carlo Ancelotti",
			nation: "Italy",
			league: leagues[0] ?? "LALIGA EA SPORTS",
		});

		return squad;
	}
}
