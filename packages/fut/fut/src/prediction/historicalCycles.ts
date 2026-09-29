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

import type { FutPlatform, IntraWeekDay, MarketPhase } from "./types.ts";

export interface CyclePhaseConfig {
	phase: MarketPhase;
	dayRange: [number, number]; // [startDay, endDay] of annual cycle
	metaMultiplierCurve: (dayInCycle: number) => number;
	fodderMultiplierCurve: (dayInCycle: number) => number;
	description: string;
}

export interface HistoricalPlayerArchetype {
	tierName: string;
	examplePlayersFC26: string[];
	fc26Day0Price: number;
	fc26Day7Price: number;
	fc26Day14Price: number;
	fc26Day30Price: number;
	fc26Day60Price: number;
}

export type MarketArchetypeKey =
	| "ELITE_META_90_PLUS"
	| "MID_META_83_87"
	| "HIGH_FODDER_88_90"
	| "MID_FODDER_84_86"
	| "DISCARD_GOLDS_75_82";

/**
 * Historical FC 26 Reference Curves for Console (PlayStation 4, PlayStation 5, Xbox One, Xbox Series X|S).
 * Shared transfer market with high liquidity and massive card supply.
 */
export const FC26_CONSOLE_BENCHMARKS: Record<MarketArchetypeKey, HistoricalPlayerArchetype> = {
	ELITE_META_90_PLUS: {
		tierName: "Console Elite Tier 1 (Mbappé, Vini Jr, Hansen, Putellas)",
		examplePlayersFC26: ["Kylian Mbappé", "Vinicius Jr.", "Caroline Graham Hansen"],
		fc26Day0Price: 3200000,
		fc26Day7Price: 3550000,
		fc26Day14Price: 3950000, // Peak at first Weekend League
		fc26Day30Price: 3700000,
		fc26Day60Price: 3100000, // Pre-Black Friday dip
	},
	MID_META_83_87: {
		tierName: "Console Competitive Meta (Mendy, Valverde, Saliba, Leao, Davies)",
		examplePlayersFC26: ["Ferland Mendy", "Federico Valverde", "William Saliba", "Theo Hernández"],
		fc26Day0Price: 65000,
		fc26Day7Price: 110000,
		fc26Day14Price: 145000, // Explosive spike as players build WL squads
		fc26Day30Price: 85000,
		fc26Day60Price: 38000, // Gradual pack-supply deflation
	},
	HIGH_FODDER_88_90: {
		tierName: "Console High-Rated Fodder (Kroos, Paredes, Kane, Modric)",
		examplePlayersFC26: ["Toni Kroos", "Irene Paredes", "Harry Kane", "Luka Modrić"],
		fc26Day0Price: 11500,
		fc26Day7Price: 13000,
		fc26Day14Price: 22500, // Massive spike on first repeatable Hero/Icon SBC
		fc26Day30Price: 19000,
		fc26Day60Price: 24000,
	},
	MID_FODDER_84_86: {
		tierName: "Console Mid-Rated Fodder (84-86 SBC fillers)",
		examplePlayersFC26: ["Memphis Depay", "Dani Parejo", "Ruben Neves", "Thiago Silva"],
		fc26Day0Price: 2200,
		fc26Day7Price: 3100,
		fc26Day14Price: 6800, // Spike on POTM & Upgrade packs
		fc26Day30Price: 5200,
		fc26Day60Price: 7500,
	},
	DISCARD_GOLDS_75_82: {
		tierName: "Console Common/Discard Golds (Non-meta 75-82)",
		examplePlayersFC26: ["Generic 79 CB", "Generic 80 ST"],
		fc26Day0Price: 1400,
		fc26Day7Price: 950,
		fc26Day14Price: 650, // Floor collapse as supply floods market
		fc26Day30Price: 450,
		fc26Day60Price: 400,
	},
};

/**
 * Historical FC 26 Reference Curves for PC (EA App / Steam / Epic Games).
 * Isolated transfer market with lower liquidity, smaller supply, and higher elite price premiums (+20% to +45%).
 */
export const FC26_PC_BENCHMARKS: Record<MarketArchetypeKey, HistoricalPlayerArchetype> = {
	ELITE_META_90_PLUS: {
		tierName: "PC Elite Tier 1 (Mbappé, Vini Jr, Hansen) - High Scarcity & Extinction Risk",
		examplePlayersFC26: ["Kylian Mbappé", "Vinicius Jr.", "Caroline Graham Hansen"],
		fc26Day0Price: 4100000,
		fc26Day7Price: 4600000,
		fc26Day14Price: 5250000, // Extinction threshold on PC
		fc26Day30Price: 4900000,
		fc26Day60Price: 4200000,
	},
	MID_META_83_87: {
		tierName: "PC Competitive Meta (Mendy, Valverde, Saliba)",
		examplePlayersFC26: ["Ferland Mendy", "Federico Valverde", "William Saliba", "Theo Hernández"],
		fc26Day0Price: 85000,
		fc26Day7Price: 145000,
		fc26Day14Price: 185000, // Heavy spike due to low card listings
		fc26Day30Price: 105000,
		fc26Day60Price: 48000,
	},
	HIGH_FODDER_88_90: {
		tierName: "PC High-Rated Fodder (Kroos, Kane, Modric)",
		examplePlayersFC26: ["Toni Kroos", "Irene Paredes", "Harry Kane", "Luka Modrić"],
		fc26Day0Price: 12500,
		fc26Day7Price: 14000,
		fc26Day14Price: 25000, // Rapid exhaustion on repeatable SBCs
		fc26Day30Price: 21500,
		fc26Day60Price: 27500,
	},
	MID_FODDER_84_86: {
		tierName: "PC Mid-Rated Fodder (84-86 SBC fillers)",
		examplePlayersFC26: ["Memphis Depay", "Dani Parejo", "Ruben Neves", "Thiago Silva"],
		fc26Day0Price: 2400,
		fc26Day7Price: 3400,
		fc26Day14Price: 7500,
		fc26Day30Price: 5800,
		fc26Day60Price: 8200,
	},
	DISCARD_GOLDS_75_82: {
		tierName: "PC Common/Discard Golds (Non-meta 75-82)",
		examplePlayersFC26: ["Generic 79 CB", "Generic 80 ST"],
		fc26Day0Price: 1500,
		fc26Day7Price: 1050,
		fc26Day14Price: 700,
		fc26Day30Price: 450,
		fc26Day60Price: 400,
	},
};

/**
 * Backward compatibility alias: default benchmarks point to Console.
 */
export const FC26_ARCHETYPE_BENCHMARKS = FC26_CONSOLE_BENCHMARKS;

/**
 * Intra-Week Day Multipliers for Console (PlayStation 4/5 & Xbox One/Series).
 */
export const INTRA_WEEK_MULTIPLIERS: Record<
	IntraWeekDay,
	{ metaMultiplier: number; fodderMultiplier: number; description: string }
> = {
	MONDAY: {
		metaMultiplier: 0.93, // Weekend League sell-off bottom
		fodderMultiplier: 1.05, // Repeatable upgrade SBC drops
		description: "Console Post-WL dump: best day to buy meta players",
	},
	TUESDAY: {
		metaMultiplier: 0.95,
		fodderMultiplier: 1.03,
		description: "Console market stabilization & accumulation phase",
	},
	WEDNESDAY: {
		metaMultiplier: 0.96,
		fodderMultiplier: 1.02,
		description: "Pre-rewards accumulation phase",
	},
	THURSDAY: {
		metaMultiplier: 1.04, // Division Rivals rewards injection
		fodderMultiplier: 1.08, // Marquee Matchups & SBC content
		description: "Coin injection morning: prices begin uptrend",
	},
	FRIDAY: {
		metaMultiplier: 1.10, // Weekend League qualification & squad building panic
		fodderMultiplier: 0.95, // Promo pack opening injects heavy fodder supply
		description: "Weekly peak for competitive meta cards; sell before 19:00",
	},
	SATURDAY: {
		metaMultiplier: 1.06,
		fodderMultiplier: 0.96,
		description: "High volume, plateauing meta prices",
	},
	SUNDAY: {
		metaMultiplier: 0.98,
		fodderMultiplier: 1.06, // Sunday Content Drop (Icon/Hero pack gamble)
		description: "Late evening sell-off begins; fodder rises on content drop",
	},
};

/**
 * Intra-Week Day Multipliers for PC Market.
 * Amplified amplitude due to thinner order books and lower player count.
 */
export const INTRA_WEEK_PC_MULTIPLIERS: Record<
	IntraWeekDay,
	{ metaMultiplier: number; fodderMultiplier: number; description: string }
> = {
	MONDAY: {
		metaMultiplier: 0.90, // Sharper dump on PC due to thin buyer interest
		fodderMultiplier: 1.06,
		description: "PC Post-WL crash: steep undercutting from sellers",
	},
	TUESDAY: {
		metaMultiplier: 0.93,
		fodderMultiplier: 1.04,
		description: "PC accumulation day: wide bid-ask spreads",
	},
	WEDNESDAY: {
		metaMultiplier: 0.96,
		fodderMultiplier: 1.03,
		description: "PC pre-rewards holding",
	},
	THURSDAY: {
		metaMultiplier: 1.05,
		fodderMultiplier: 1.09,
		description: "PC Rivals rewards: meta supply quickly clears out",
	},
	FRIDAY: {
		metaMultiplier: 1.14, // Extreme scarcity peak on PC
		fodderMultiplier: 0.94,
		description: "PC Weekly peak: acute card scarcity on top meta",
	},
	SATURDAY: {
		metaMultiplier: 1.08,
		fodderMultiplier: 0.95,
		description: "PC Saturday: high volatility",
	},
	SUNDAY: {
		metaMultiplier: 0.96,
		fodderMultiplier: 1.07,
		description: "PC Sunday sell-off starts earlier",
	},
};

/**
 * Gets intra-week multipliers adapted to the specific platform.
 */
export function getIntraWeekMultipliers(
	day: IntraWeekDay,
	platform: FutPlatform = "console",
): { metaMultiplier: number; fodderMultiplier: number; description: string } {
	return platform === "pc" ? INTRA_WEEK_PC_MULTIPLIERS[day] : INTRA_WEEK_MULTIPLIERS[day];
}

/**
 * Calculates current market phase from launch date (assumed September 20).
 */
export function getCurrentMarketPhase(referenceDate: Date = new Date()): {
	phase: MarketPhase;
	dayInCycle: number;
} {
	// Game launch reference date (e.g. Sept 20, 2026)
	const launchDate = new Date(referenceDate.getFullYear(), 8, 20); // Sept 20
	const diffMs = referenceDate.getTime() - launchDate.getTime();
	const dayInCycle = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

	if (dayInCycle <= 5) return { phase: "PRE_LAUNCH", dayInCycle };
	if (dayInCycle <= 12) return { phase: "LAUNCH_WEEK", dayInCycle };
	if (dayInCycle <= 20) return { phase: "FIRST_WL", dayInCycle };
	if (dayInCycle <= 50) return { phase: "EARLY_CYCLE", dayInCycle };
	if (dayInCycle <= 65) return { phase: "PRE_BLACK_FRIDAY", dayInCycle };
	if (dayInCycle <= 110) return { phase: "MID_CYCLE", dayInCycle };
	if (dayInCycle <= 130) return { phase: "TOTY_CRASH", dayInCycle };
	return { phase: "LATE_CYCLE", dayInCycle };
}

/**
 * Computes day of week enum from any date.
 */
export function getIntraWeekDay(date: Date = new Date()): IntraWeekDay {
	const dayIndex = date.getDay(); // 0 is Sunday, 1 is Monday...
	switch (dayIndex) {
		case 0:
			return "SUNDAY";
		case 1:
			return "MONDAY";
		case 2:
			return "TUESDAY";
		case 3:
			return "WEDNESDAY";
		case 4:
			return "THURSDAY";
		case 5:
			return "FRIDAY";
		case 6:
			return "SATURDAY";
		default:
			return "WEDNESDAY";
	}
}

/**
 * Computes the FC 26 historical trajectory change factor over a given time delta (in days).
 */
export function getHistoricalTrajectoryFactor(
	tier: MarketArchetypeKey,
	dayInCycle: number,
	horizonDays: number,
	platform: FutPlatform = "console",
): number {
	const bench = platform === "pc" ? FC26_PC_BENCHMARKS[tier] : FC26_CONSOLE_BENCHMARKS[tier];
	if (!bench) return 1.0;

	// Interpolate price at dayInCycle
	const getPriceAtDay = (d: number): number => {
		if (d <= 0) return bench.fc26Day0Price;
		if (d <= 7) return bench.fc26Day0Price + ((bench.fc26Day7Price - bench.fc26Day0Price) * d) / 7;
		if (d <= 14) return bench.fc26Day7Price + ((bench.fc26Day14Price - bench.fc26Day7Price) * (d - 7)) / 7;
		if (d <= 30) return bench.fc26Day14Price + ((bench.fc26Day30Price - bench.fc26Day14Price) * (d - 14)) / 16;
		if (d <= 60) return bench.fc26Day30Price + ((bench.fc26Day60Price - bench.fc26Day30Price) * (d - 30)) / 30;
		return bench.fc26Day60Price * 0.9;
	};

	const pStart = getPriceAtDay(dayInCycle);
	const pEnd = getPriceAtDay(dayInCycle + horizonDays);

	return pStart > 0 ? pEnd / pStart : 1.0;
}
