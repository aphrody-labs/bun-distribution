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


export type PitchPosition =
	| "GK"
	| "RB"
	| "RWB"
	| "CB"
	| "LB"
	| "LWB"
	| "CDM"
	| "CM"
	| "CAM"
	| "RM"
	| "LM"
	| "RW"
	| "LW"
	| "RF"
	| "CF"
	| "LF"
	| "ST";

export interface PitchCoordinate {
	/** X percentage across pitch (0 = left, 50 = center, 100 = right) */
	x: number;
	/** Y percentage down pitch (0 = striker/top, 50 = midfield, 90 = keeper/bottom) */
	y: number;
}

export interface FormationSlotDefinition {
	slotIndex: number;
	defaultPosition: PitchPosition;
	allowedPositions: PitchPosition[];
	coordinates: PitchCoordinate;
	defaultRole: string;
	defaultFocus: "Defend" | "Balanced" | "Attack" | "Roaming" | "Playmaker";
}

export interface FormationDefinition {
	id: number;
	name: string;
	category: "3-at-the-back" | "4-at-the-back" | "5-at-the-back";
	slots: FormationSlotDefinition[];
}

export interface SquadPlayerItem {
	id: string;
	name: string;
	rating: number;
	primaryPosition: PitchPosition;
	alternativePositions: PitchPosition[];
	club: string;
	clubId?: number;
	league: string;
	leagueId?: number;
	nation: string;
	nationId?: number;
	rarity?: string;
	isIcon?: boolean;
	isHero?: boolean;
	pac?: number;
	sho?: number;
	pas?: number;
	dri?: number;
	def?: number;
	phy?: number;
	skillMoves?: number;
	weakFoot?: number;
	foot?: "Right" | "Left";
	accelerateType?: string;
	playstyles?: string[];
	playstylesPlus?: string[];
	rolesPlus?: string[];
	rolesPlusPlus?: string[];
	priceConsole?: number;
	pricePc?: number;
}

export interface SquadSlotState {
	slotIndex: number;
	position: PitchPosition;
	coordinates: PitchCoordinate;
	player?: SquadPlayerItem;
	assignedRole?: string;
	assignedRoleTier?: "base" | "plus" | "plus_plus";
	assignedFocus?: "Defend" | "Balanced" | "Attack" | "Roaming" | "Playmaker";
	chemistry: number; // 0, 1, 2, or 3
	inPosition: boolean;
}

export interface SquadManager {
	name: string;
	nation: string;
	league: string;
}

export interface ChemistryThresholdProgress {
	name: string;
	count: number;
	points: number; // 0, 1, 2, or 3
	nextThreshold: number | null;
}

export interface SquadChemistryReport {
	totalChemistry: number; // 0 to 33
	maxPossibleChemistry: number; // 33
	isFullChemistry: boolean;
	clubs: Record<string, ChemistryThresholdProgress>;
	nations: Record<string, ChemistryThresholdProgress>;
	leagues: Record<string, ChemistryThresholdProgress>;
	playerBreakdowns: Array<{
		slotIndex: number;
		playerName: string;
		inPosition: boolean;
		clubPoints: number;
		nationPoints: number;
		leaguePoints: number;
		totalPoints: number;
	}>;
}

export interface SquadStatsSummary {
	squadRating: number;
	attackRating: number;
	midfieldRating: number;
	defenseRating: number;
	totalInGameStats: number;
	totalPriceConsole: number;
	totalPricePc: number;
	accelerateCounts: Record<string, number>;
	playstylesDistribution: Record<string, number>;
	playstylesPlusCount: number;
	rolesPlusCount: number;
	rolesPlusPlusCount: number;
}

export interface SquadSerialized {
	version: number;
	formation: string;
	starters: Array<{
		slotIndex: number;
		playerId?: string;
		playerData?: SquadPlayerItem;
		assignedRole?: string;
		assignedFocus?: "Defend" | "Balanced" | "Attack" | "Roaming" | "Playmaker";
	}>;
	substitutes: SquadPlayerItem[];
	reserves: SquadPlayerItem[];
	manager?: SquadManager;
}
