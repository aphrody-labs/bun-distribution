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

import type { MasterPlayerStats } from "../db/types.ts";
import type { ChemistryStyleName } from "./types.ts";

export interface ChemistryBonusMap {
	[statKey: string]: number; // Max bonus at 3 chemistry
}

export const CHEMISTRY_STYLE_BONUSES: Record<ChemistryStyleName, ChemistryBonusMap> = {
	Basic: {
		acceleration: 4,
		sprintSpeed: 4,
		positioning: 4,
		finishing: 4,
		shotPower: 4,
		shortPassing: 4,
		vision: 4,
		agility: 4,
		ballControl: 4,
		interceptions: 4,
		standingTackle: 4,
		jumping: 4,
		strength: 4,
	},
	Hunter: {
		acceleration: 8,
		sprintSpeed: 8,
		positioning: 4,
		finishing: 8,
		shotPower: 4,
		volleys: 8,
		penalties: 4,
	},
	Shadow: {
		acceleration: 8,
		sprintSpeed: 8,
		interceptions: 8,
		headingAccuracy: 4,
		defAwareness: 4,
		standingTackle: 8,
		slidingTackle: 8,
	},
	Catalyst: {
		acceleration: 8,
		sprintSpeed: 8,
		crossing: 8,
		freeKickAccuracy: 8,
		shortPassing: 4,
		vision: 8,
		curve: 4,
	},
	Hawk: {
		acceleration: 4,
		sprintSpeed: 4,
		positioning: 4,
		finishing: 4,
		shotPower: 8,
		longShots: 8,
		jumping: 4,
		strength: 4,
		aggression: 8,
	},
	Anchor: {
		acceleration: 4,
		sprintSpeed: 4,
		interceptions: 4,
		defAwareness: 4,
		standingTackle: 8,
		slidingTackle: 8,
		jumping: 8,
		strength: 8,
		aggression: 4,
	},
	Engine: {
		acceleration: 4,
		sprintSpeed: 4,
		vision: 4,
		crossing: 4,
		shortPassing: 8,
		curve: 4,
		agility: 4,
		balance: 8,
		dribblingSub: 8,
	},
	Sentinel: {
		interceptions: 4,
		headingAccuracy: 8,
		defAwareness: 8,
		standingTackle: 8,
		slidingTackle: 4,
		jumping: 8,
		strength: 8,
		aggression: 4,
	},
	Gladiator: {
		positioning: 8,
		finishing: 8,
		shotPower: 8,
		interceptions: 8,
		standingTackle: 8,
		slidingTackle: 8,
	},
	Backbone: {
		vision: 4,
		shortPassing: 4,
		longPassing: 4,
		interceptions: 4,
		standingTackle: 8,
		jumping: 4,
		strength: 4,
		aggression: 4,
	},
	Finisher: {
		positioning: 4,
		finishing: 15,
		shotPower: 4,
		volleys: 8,
		penalties: 4,
		agility: 8,
		dribblingSub: 8,
	},
	Deadeye: {
		positioning: 8,
		finishing: 8,
		shotPower: 8,
		vision: 8,
		shortPassing: 8,
		curve: 4,
	},
	Marksman: {
		finishing: 8,
		shotPower: 4,
		longShots: 8,
		volleys: 4,
		reactions: 4,
		ballControl: 4,
		dribblingSub: 8,
		jumping: 8,
		strength: 4,
	},
	Sniper: {
		finishing: 8,
		volleys: 4,
		penalties: 8,
		jumping: 8,
		strength: 8,
		aggression: 8,
	},
	Artist: {
		crossing: 8,
		vision: 8,
		longPassing: 8,
		curve: 8,
		agility: 8,
		dribblingSub: 8,
	},
	Architect: {
		vision: 4,
		crossing: 8,
		freeKickAccuracy: 8,
		shortPassing: 8,
		longPassing: 4,
		jumping: 4,
		strength: 15,
		aggression: 4,
	},
	Powerhouse: {
		vision: 8,
		crossing: 4,
		shortPassing: 8,
		longPassing: 8,
		interceptions: 8,
		defAwareness: 4,
		standingTackle: 8,
	},
	Maestro: {
		shotPower: 4,
		longShots: 8,
		volleys: 4,
		vision: 4,
		freeKickAccuracy: 4,
		shortPassing: 4,
		longPassing: 4,
		reactions: 4,
		dribblingSub: 8,
	},
	Guardian: {
		balance: 8,
		dribblingSub: 8,
		composure: 4,
		interceptions: 4,
		defAwareness: 8,
		standingTackle: 8,
		slidingTackle: 8,
	},
	GkBasic: {
		gkDiving: 4,
		gkHandling: 4,
		gkKicking: 4,
		gkReflexes: 4,
		gkSpeed: 4,
		gkPositioning: 4,
	},
	Wall: {
		gkDiving: 8,
		gkHandling: 8,
		gkKicking: 8,
	},
	Shield: {
		gkKicking: 8,
		gkReflexes: 8,
		gkSpeed: 8,
	},
	Cat: {
		gkReflexes: 8,
		gkSpeed: 8,
		gkPositioning: 8,
	},
	Glove: {
		gkDiving: 8,
		gkHandling: 8,
		gkPositioning: 8,
	},
};

export class InGameStatsCalculator {
	/**
	 * Computes modulated In-Game Stats given base stats, chemistry style, and chemistry points (0 to 3).
	 */
	public static applyChemistry(
		baseStats: MasterPlayerStats,
		style: ChemistryStyleName,
		chemistryPoints: 0 | 1 | 2 | 3,
	): MasterPlayerStats {
		const result: MasterPlayerStats = { ...baseStats };
		if (chemistryPoints === 0) return result;

		const multiplier = chemistryPoints / 3;
		const bonuses = CHEMISTRY_STYLE_BONUSES[style] || {};

		for (const [statKey, maxBonus] of Object.entries(bonuses)) {
			if (statKey in result) {
				const currentVal = (result as any)[statKey] ?? 50;
				const added = Math.floor(maxBonus * multiplier);
				(result as any)[statKey] = Math.min(99, currentVal + added);
			}
		}

		// Recompute main face card stats from modulated in-game stats
		result.pace = Math.round((result.acceleration * 0.45) + (result.sprintSpeed * 0.55));
		result.shooting = Math.round(
			(result.positioning * 0.05) +
			(result.finishing * 0.45) +
			(result.shotPower * 0.20) +
			(result.longShots * 0.20) +
			(result.volleys * 0.05) +
			(result.penalties * 0.05),
		);
		result.passing = Math.round(
			(result.vision * 0.20) +
			(result.crossing * 0.20) +
			(result.freeKickAccuracy * 0.05) +
			(result.shortPassing * 0.35) +
			(result.longPassing * 0.15) +
			(result.curve * 0.05),
		);
		result.dribbling = Math.round(
			(result.agility * 0.10) +
			(result.balance * 0.05) +
			(result.reactions * 0.10) +
			(result.ballControl * 0.35) +
			(result.dribblingSub * 0.35) +
			(result.composure * 0.05),
		);
		result.defending = Math.round(
			(result.interceptions * 0.20) +
			(result.headingAccuracy * 0.10) +
			(result.defAwareness * 0.30) +
			(result.standingTackle * 0.30) +
			(result.slidingTackle * 0.10),
		);
		result.physicality = Math.round(
			(result.jumping * 0.05) +
			(result.stamina * 0.25) +
			(result.strength * 0.50) +
			(result.aggression * 0.20),
		);

		return result;
	}

	/**
	 * Computes in-match stamina and fatigue degradation at minute M.
	 */
	public static applyFatigue(stats: MasterPlayerStats, matchMinute: number): MasterPlayerStats {
		if (matchMinute <= 0) return stats;
		const decayFactor = Math.max(0.65, 1 - (matchMinute / 90) * (1 - (stats.stamina / 120)));
		return {
			...stats,
			pace: Math.round(stats.pace * decayFactor),
			acceleration: Math.round(stats.acceleration * decayFactor),
			sprintSpeed: Math.round(stats.sprintSpeed * decayFactor),
			stamina: Math.max(1, Math.round(stats.stamina * (1 - matchMinute / 95))),
		};
	}
}
