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

import { calculateSquadChemistry, isPlayerInPosition } from "./chemistry.ts";
import { getFormation } from "./formations.ts";
import { analyzeTacticalBalance, evaluatePlayerRoleTier } from "./roles.ts";
import type {
	FormationDefinition,
	SquadChemistryReport,
	SquadManager,
	SquadPlayerItem,
	SquadSerialized,
	SquadSlotState,
	SquadStatsSummary,
} from "./types.ts";

export class Squad {
	public formation: FormationDefinition;
	public starters: Map<
		number,
		{
			player?: SquadPlayerItem;
			assignedRole?: string;
			assignedFocus?: "Defend" | "Balanced" | "Attack" | "Roaming" | "Playmaker";
		}
	> = new Map();
	public substitutes: SquadPlayerItem[] = [];
	public reserves: SquadPlayerItem[] = [];
	public manager?: SquadManager;

	constructor(formationName: string = "4-4-2") {
		this.formation = getFormation(formationName);
		for (const slot of this.formation.slots) {
			this.starters.set(slot.slotIndex, {
				assignedRole: slot.defaultRole,
				assignedFocus: slot.defaultFocus,
			});
		}
	}

	public static create(formationName: string = "4-4-2"): Squad {
		return new Squad(formationName);
	}

	public changeFormation(newFormationName: string): this {
		const newFormation = getFormation(newFormationName);
		const oldStarters = Array.from(this.starters.entries());

		this.formation = newFormation;
		this.starters.clear();

		// Remap old players to new slots by closest or matching position
		for (const slotDef of newFormation.slots) {
			this.starters.set(slotDef.slotIndex, {
				assignedRole: slotDef.defaultRole,
				assignedFocus: slotDef.defaultFocus,
			});
		}

		// Keep players in same slot index if position matches or fits
		for (const [slotIdx, data] of oldStarters) {
			if (data.player && slotIdx < newFormation.slots.length) {
				const slotDef = newFormation.slots[slotIdx];
				this.starters.set(slotIdx, {
					player: data.player,
					assignedRole: data.assignedRole ?? slotDef.defaultRole,
					assignedFocus: data.assignedFocus ?? slotDef.defaultFocus,
				});
			}
		}

		return this;
	}

	public setPlayer(
		slotIndex: number,
		player: SquadPlayerItem,
		assignedRole?: string,
		assignedFocus?: "Defend" | "Balanced" | "Attack" | "Roaming" | "Playmaker",
	): this {
		if (slotIndex < 0 || slotIndex >= this.formation.slots.length) {
			throw new Error(`Invalid slot index ${slotIndex}. Formation ${this.formation.name} has 11 starting slots (0-10).`);
		}
		const slotDef = this.formation.slots[slotIndex];
		this.starters.set(slotIndex, {
			player,
			assignedRole: assignedRole ?? slotDef.defaultRole,
			assignedFocus: assignedFocus ?? slotDef.defaultFocus,
		});
		return this;
	}

	public removePlayer(slotIndex: number): this {
		const slotDef = this.formation.slots[slotIndex];
		if (slotDef) {
			this.starters.set(slotIndex, {
				assignedRole: slotDef.defaultRole,
				assignedFocus: slotDef.defaultFocus,
			});
		}
		return this;
	}

	public swapSlots(slotA: number, slotB: number): this {
		const itemA = this.starters.get(slotA);
		const itemB = this.starters.get(slotB);
		if (itemA && itemB) {
			this.starters.set(slotA, itemB);
			this.starters.set(slotB, itemA);
		}
		return this;
	}

	public setManager(manager?: SquadManager): this {
		this.manager = manager;
		return this;
	}

	public addSubstitute(player: SquadPlayerItem): this {
		if (this.substitutes.length >= 9) {
			throw new Error("Bench is full (maximum 9 substitutes).");
		}
		this.substitutes.push(player);
		return this;
	}

	public addReserve(player: SquadPlayerItem): this {
		if (this.reserves.length >= 5) {
			throw new Error("Reserves is full (maximum 5 reserves).");
		}
		this.reserves.push(player);
		return this;
	}

	public getSlots(): SquadSlotState[] {
		const chemistryReport = this.getChemistry();
		const result: SquadSlotState[] = [];

		for (const slotDef of this.formation.slots) {
			const entry = this.starters.get(slotDef.slotIndex);
			const player = entry?.player;
			const inPos = player ? isPlayerInPosition(player, slotDef.defaultPosition, slotDef.allowedPositions) : false;

			const breakdown = chemistryReport.playerBreakdowns.find((p) => p.slotIndex === slotDef.slotIndex);
			const tier = player && entry?.assignedRole ? evaluatePlayerRoleTier(player, entry.assignedRole) : "base";

			result.push({
				slotIndex: slotDef.slotIndex,
				position: slotDef.defaultPosition,
				coordinates: slotDef.coordinates,
				player,
				assignedRole: entry?.assignedRole ?? slotDef.defaultRole,
				assignedRoleTier: tier,
				assignedFocus: entry?.assignedFocus ?? slotDef.defaultFocus,
				chemistry: breakdown?.totalPoints ?? 0,
				inPosition: inPos,
			});
		}

		return result;
	}

	public getChemistry(): SquadChemistryReport {
		const starterItems = Array.from(this.starters.entries()).map(([slotIndex, data]) => ({
			slotIndex,
			player: data.player,
		}));
		return calculateSquadChemistry(this.formation, starterItems, this.manager);
	}

	public getTacticalBalance() {
		return analyzeTacticalBalance(this.getSlots());
	}

	public getStats(): SquadStatsSummary {
		const slots = this.getSlots();
		const validPlayers = slots.map((s) => s.player).filter((p): p is SquadPlayerItem => p !== undefined);

		if (validPlayers.length === 0) {
			return {
				squadRating: 0,
				attackRating: 0,
				midfieldRating: 0,
				defenseRating: 0,
				totalInGameStats: 0,
				totalPriceConsole: 0,
				totalPricePc: 0,
				accelerateCounts: {},
				playstylesDistribution: {},
				playstylesPlusCount: 0,
				rolesPlusCount: 0,
				rolesPlusPlusCount: 0,
			};
		}

		// Squad rating calculation
		const sumRatings = validPlayers.reduce((acc, p) => acc + p.rating, 0);
		const avgRating = Math.round(sumRatings / validPlayers.length);

		// Category ratings
		const attackers = slots.filter((s) => ["ST", "CF", "RF", "LF", "RW", "LW"].includes(s.position) && s.player);
		const midfielders = slots.filter((s) => ["CM", "CDM", "CAM", "RM", "LM"].includes(s.position) && s.player);
		const defenders = slots.filter((s) => ["CB", "LB", "RB", "LWB", "RWB", "GK"].includes(s.position) && s.player);

		const attackRating = attackers.length > 0 ? Math.round(attackers.reduce((a, s) => a + s.player!.rating, 0) / attackers.length) : avgRating;
		const midfieldRating = midfielders.length > 0 ? Math.round(midfielders.reduce((a, s) => a + s.player!.rating, 0) / midfielders.length) : avgRating;
		const defenseRating = defenders.length > 0 ? Math.round(defenders.reduce((a, s) => a + s.player!.rating, 0) / defenders.length) : avgRating;

		// Total in-game stats
		let totalInGameStats = 0;
		let totalPriceConsole = 0;
		let totalPricePc = 0;
		const accelerateCounts: Record<string, number> = {};
		const playstylesDistribution: Record<string, number> = {};
		let playstylesPlusCount = 0;
		let rolesPlusCount = 0;
		let rolesPlusPlusCount = 0;

		for (const slot of slots) {
			const p = slot.player;
			if (!p) continue;

			const faceSum = (p.pac ?? 0) + (p.sho ?? 0) + (p.pas ?? 0) + (p.dri ?? 0) + (p.def ?? 0) + (p.phy ?? 0);
			totalInGameStats += faceSum;

			totalPriceConsole += p.priceConsole ?? 0;
			totalPricePc += p.pricePc ?? (p.priceConsole ?? 0);

			if (p.accelerateType) {
				accelerateCounts[p.accelerateType] = (accelerateCounts[p.accelerateType] ?? 0) + 1;
			}

			if (p.playstyles) {
				for (const ps of p.playstyles) {
					playstylesDistribution[ps] = (playstylesDistribution[ps] ?? 0) + 1;
				}
			}

			if (p.playstylesPlus) {
				playstylesPlusCount += p.playstylesPlus.length;
			}

			if (slot.assignedRoleTier === "plus") rolesPlusCount++;
			if (slot.assignedRoleTier === "plus_plus") rolesPlusPlusCount++;
		}

		return {
			squadRating: avgRating,
			attackRating,
			midfieldRating,
			defenseRating,
			totalInGameStats,
			totalPriceConsole,
			totalPricePc,
			accelerateCounts,
			playstylesDistribution,
			playstylesPlusCount,
			rolesPlusCount,
			rolesPlusPlusCount,
		};
	}

	public toJSON(): SquadSerialized {
		const starters: SquadSerialized["starters"] = [];
		for (const slotDef of this.formation.slots) {
			const entry = this.starters.get(slotDef.slotIndex);
			starters.push({
				slotIndex: slotDef.slotIndex,
				playerId: entry?.player?.id,
				playerData: entry?.player,
				assignedRole: entry?.assignedRole,
				assignedFocus: entry?.assignedFocus,
			});
		}
		return {
			version: 1,
			formation: this.formation.name,
			starters,
			substitutes: [...this.substitutes],
			reserves: [...this.reserves],
			manager: this.manager ? { ...this.manager } : undefined,
		};
	}

	public static fromJSON(json: SquadSerialized): Squad {
		const squad = new Squad(json.formation);
		for (const s of json.starters) {
			if (s.playerData) {
				squad.setPlayer(s.slotIndex, s.playerData, s.assignedRole, s.assignedFocus);
			}
		}
		for (const sub of json.substitutes || []) {
			squad.addSubstitute(sub);
		}
		for (const res of json.reserves || []) {
			squad.addReserve(res);
		}
		if (json.manager) {
			squad.setManager(json.manager);
		}
		return squad;
	}
}
