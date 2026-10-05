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



export type BuildUpPlayStyle = "ShortPassing" | "Balanced" | "DirectPassing" | "LongBall";
export type DefensiveApproach = "Deep" | "Balanced" | "HighPress" | "Aggressive";

export type RoleFocus = "Defend" | "Balanced" | "Attack" | "Roaming";
export type RoleMastery = "Base" | "Role+" | "Role++";

export interface PlayerRoleAssignment {
	slotIndex: number; // 0 to 10
	position: string;  // GK, RB, CB, LB, CDM, CM, CAM, RW, LW, ST, etc.
	roleId: string;    // e.g. "false_9", "box_to_box", "inverted_wingback"
	focus: RoleFocus;
	mastery?: RoleMastery;
}

export interface FcIqTacticalSetup {
	formationId: string; // e.g. "4-3-3-4", "4-2-3-1", "5-2-2-1"
	buildUpStyle: BuildUpPlayStyle;
	defensiveApproach: DefensiveApproach;
	defensiveLineDepth: number; // 1 to 100
	roles: PlayerRoleAssignment[];
}

export type ChemistryStyleName =
	| "Basic"
	| "Hunter"
	| "Shadow"
	| "Catalyst"
	| "Hawk"
	| "Anchor"
	| "Engine"
	| "Sentinel"
	| "Gladiator"
	| "Backbone"
	| "Finisher"
	| "Deadeye"
	| "Marksman"
	| "Sniper"
	| "Artist"
	| "Architect"
	| "Powerhouse"
	| "Maestro"
	| "Guardian"
	| "GkBasic"
	| "Wall"
	| "Shield"
	| "Cat"
	| "Glove";

export interface SimulatedMatchEvent {
	minute: number;
	type: "Goal" | "Shot" | "Save" | "YellowCard" | "RedCard" | "Foul" | "Corner";
	team: "Home" | "Away";
	playerName: string;
	detail?: string;
}

export interface MatchSimulationResult {
	homeScore: number;
	awayScore: number;
	homeXg: number;
	awayXg: number;
	homePossession: number; // e.g. 54%
	awayPossession: number; // e.g. 46%
	homeShots: number;
	awayShots: number;
	homeShotsOnTarget: number;
	awayShotsOnTarget: number;
	events: SimulatedMatchEvent[];
	durationMinutes: number;
}
