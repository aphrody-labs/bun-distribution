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

export type PreferredFoot = "Left" | "Right";
export type WeakFoot = 1 | 2 | 3 | 4 | 5;
export type SkillMoves = 1 | 2 | 3 | 4 | 5;

export type AcceleRateType =
	| "Lengthy"
	| "Mostly Lengthy"
	| "Controlled Lengthy"
	| "Controlled"
	| "Controlled Explosive"
	| "Mostly Explosive"
	| "Explosive";

export interface MasterPlayerStats {
	overallRating: number;
	potentialRating: number;
	pace: number;
	shooting: number;
	passing: number;
	dribbling: number;
	defending: number;
	physicality: number;

	// In-Game Detailed Stats (Pace)
	acceleration: number;
	sprintSpeed: number;

	// Shooting
	positioning: number;
	finishing: number;
	shotPower: number;
	longShots: number;
	volleys: number;
	penalties: number;

	// Passing
	vision: number;
	crossing: number;
	freeKickAccuracy: number;
	shortPassing: number;
	longPassing: number;
	curve: number;

	// Dribbling
	agility: number;
	balance: number;
	reactions: number;
	ballControl: number;
	dribblingSub: number;
	composure: number;

	// Defending
	interceptions: number;
	headingAccuracy: number;
	defAwareness: number;
	standingTackle: number;
	slidingTackle: number;

	// Physicality
	jumping: number;
	stamina: number;
	strength: number;
	aggression: number;

	// Goalkeeper (if applicable)
	gkDiving?: number;
	gkHandling?: number;
	gkKicking?: number;
	gkReflexes?: number;
	gkSpeed?: number;
	gkPositioning?: number;
}

export interface PlaystyleEntry {
	id: number;
	name: string;
	category: "Scoring" | "Passing" | "Ball Control" | "Defending" | "Physical" | "Goalkeeper";
	isPlus: boolean;
}

export interface FcIqRoleEntry {
	position: string; // ST, LW, RW, CAM, CM, CDM, LB, CB, RB, GK
	roleName: string; // e.g. "False 9", "Box-to-Box", "Inverted Wingback"
	masteryLevel: "Base" | "Role+" | "Role++";
	focus?: "Defend" | "Balanced" | "Attack" | "Roaming";
}

export interface MasterPlayer {
	id: number;
	commonName: string;
	firstName: string;
	lastName: string;
	nationalityId: number;
	teamId: number;
	leagueId: number;
	position: string;
	secondaryPositions?: string[];
	birthdate?: string;
	heightCm: number;
	weightKg: number;
	preferredFoot: PreferredFoot;
	weakFoot: WeakFoot;
	skillMoves: SkillMoves;
	bodyType: string;
	realFaceId?: number;
	internationalRep: number;
	acceleRate: AcceleRateType;
	stats: MasterPlayerStats;
	playstyles: PlaystyleEntry[];
	fcIqRoles: FcIqRoleEntry[];
}

export interface MasterTeam {
	id: number;
	name: string;
	leagueId: number;
	stadiumId?: number;
	overall: number;
	attack: number;
	midfield: number;
	defense: number;
	transferBudget: number;
	wageBudget: number;
	rivalTeamId?: number;
}

export interface MasterLeague {
	id: number;
	name: string;
	nationId: number;
	tier: number;
}

export interface PlayerSearchFilter {
	name?: string;
	minOvr?: number;
	maxOvr?: number;
	leagueId?: number;
	nationalityId?: number;
	teamId?: number;
	position?: string;
	preferredFoot?: PreferredFoot;
	minWeakFoot?: number;
	minSkillMoves?: number;
	minPace?: number;
	minShooting?: number;
	minPassing?: number;
	minDribbling?: number;
	minDefending?: number;
	minPhysicality?: number;
	acceleRate?: AcceleRateType;
	playstyleName?: string;
	fcIqRole?: string;
	limit?: number;
	offset?: number;
}
