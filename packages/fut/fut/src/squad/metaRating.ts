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

export interface DetailedCardStats {
	id: string;
	name: string;
	overallRating: number;
	position: string;
	alternativePositions?: string[];
	// Face stats
	pac: number;
	sho: number;
	pas: number;
	dri: number;
	def: number;
	phy: number;
	// Critical In-Game Sub-stats (if available, or estimated from face stats)
	acceleration?: number;
	sprintSpeed?: number;
	finishing?: number;
	shotPower?: number;
	longShots?: number;
	positioning?: number;
	vision?: number;
	shortPassing?: number;
	longPassing?: number;
	agility?: number;
	balance?: number;
	reactions?: number;
	ballControl?: number;
	dribblingSub?: number;
	composure?: number;
	interceptions?: number;
	defAwareness?: number;
	standingTackle?: number;
	slidingTackle?: number;
	jumping?: number;
	stamina?: number;
	strength?: number;
	aggression?: number;
	// Meta attributes
	skillMoves: number; // 1-5
	weakFoot: number; // 1-5
	accelerateType?: string; // Explosive, Mostly Explosive, Controlled, Mostly Lengthy, Lengthy
	bodyType?: string; // Unique, Lean, Average, Stocky, High & Average
	heightCm?: number;
	playstyles?: string[];
	playstylesPlus?: string[];
	fcRole?: string; // Role ++ or Role +
}

export type MetaTier = "S+" | "S" | "A" | "B" | "C";

export interface MetaRatingReport {
	name: string;
	position: string;
	faceOvr: number;
	factualMetaRating: number;
	metaDelta: number; // meta - faceOvr (>0 = underrated bargain, <0 = fake rating / unplayable)
	tier: MetaTier;
	archetypeSummary: {
		acceleRateBonus: number;
		wfSmMultiplier: number;
		playStylesBonus: number;
		bodyTypeBonus: number;
		composureReactionsScore: number;
	};
	recommendedChemStyle: "Hunter" | "Shadow" | "Anchor" | "Engine" | "Hawk" | "Finisher" | "Basic";
	strengths: string[];
	weaknesses: string[];
}

// S-Tier PlayStyles that fundamentally alter physics & collision animations
const TIER_S_PLUS = new Set([
	"Anticipate+", // Clean surgical tackle, zero rebound to opponent
	"Intercept+", // Automated outstretched intercept reach
	"Quick Step+", // Explosive 0-10m acceleration burst
	"Finesse Shot+", // Unnatural curved top-corner trajectory
	"Rapid+", // High speed with ball without separation
	"Technical+", // R1 Controlled sprint glued to foot
	"Incisive Pass+", // Laser through-balls curving around defenders
	"Aerial+", // Unbeatable jumping & heading win rate
	"Relentless+", // Second wind + 99 effective stamina all 90 min
	"Bruiser+", // Devastating physical bump & push
]);

const TIER_A_PLUS = new Set([
	"Long Ball Pass+",
	"Tiki Taka+",
	"First Touch+",
	"Press Proven+",
	"Dead Ball+",
	"Power Shot+",
	"Jockey+",
	"Block+",
	"Slide Tackle+",
	"Whipped Pass+",
	"Low Driven+",
]);

const TIER_S_REGULAR = new Set([
	"Anticipate",
	"Intercept",
	"Quick Step",
	"Finesse Shot",
	"Rapid",
	"Technical",
	"Incisive Pass",
	"Aerial",
	"Relentless",
	"Bruiser",
]);

/**
 * Calculates a mathematically objective, empirical Meta Rating for any FC 27 card.
 */
export function calculateFactualMetaRating(card: DetailedCardStats): MetaRatingReport {
	const pos = card.position.toUpperCase();

	// 1. Resolve In-Game stats (with defaults from face stats if sub-stats missing)
	const acc = card.acceleration ?? card.pac;
	const spd = card.sprintSpeed ?? card.pac;
	const fin = card.finishing ?? card.sho;
	const pwr = card.shotPower ?? card.sho;
	const com = card.composure ?? Math.min(card.dri, 85);
	const rea = card.reactions ?? Math.min(card.dri, 85);
	const agi = card.agility ?? card.dri;
	const bal = card.balance ?? card.dri;
	const ctrl = card.ballControl ?? card.dri;
	const itc = card.interceptions ?? card.def;
	const defAw = card.defAwareness ?? card.def;
	const stk = card.standingTackle ?? card.def;
	const str = card.strength ?? card.phy;
	const sta = card.stamina ?? card.phy;

	// 2. Position-specific weighted base rating (0-99)
	let rawMeta = 0;

	if (pos === "ST" || pos === "CF") {
		// Strikers: Finishing, Pace, Composure, Reactions, Shot Power, Agility
		rawMeta =
			fin * 0.22 +
			spd * 0.14 +
			acc * 0.12 +
			com * 0.13 +
			rea * 0.11 +
			pwr * 0.10 +
			agi * 0.06 +
			bal * 0.06 +
			str * 0.06;
	} else if (pos === "LW" || pos === "RW" || pos === "LM" || pos === "RM") {
		// Wingers: Acceleration, Agility, Balance, Sprint Speed, Dribbling, Finishing, Composure
		rawMeta =
			acc * 0.20 +
			spd * 0.16 +
			agi * 0.16 +
			bal * 0.12 +
			ctrl * 0.10 +
			fin * 0.10 +
			com * 0.08 +
			rea * 0.08;
	} else if (pos === "CAM") {
		// Playmaker: Vision, Short Passing, Agility, Composure, Reactions, Finishing, Acceleration
		rawMeta =
			(card.vision ?? card.pas) * 0.18 +
			(card.shortPassing ?? card.pas) * 0.16 +
			com * 0.14 +
			rea * 0.12 +
			agi * 0.12 +
			fin * 0.10 +
			acc * 0.10 +
			bal * 0.08;
	} else if (pos === "CM") {
		// Box-to-Box: Balanced across Stamina, Passing, Defending, Pace, Composure
		rawMeta =
			sta * 0.14 +
			(card.shortPassing ?? card.pas) * 0.14 +
			itc * 0.12 +
			stk * 0.12 +
			com * 0.12 +
			rea * 0.12 +
			(card.vision ?? card.pas) * 0.10 +
			spd * 0.08 +
			str * 0.06;
	} else if (pos === "CDM") {
		// Destroyer: Interceptions, Def Awareness, Stand Tackle, Strength, Reactions, Stamina
		rawMeta =
			itc * 0.20 +
			defAw * 0.18 +
			stk * 0.18 +
			rea * 0.14 +
			str * 0.12 +
			com * 0.08 +
			spd * 0.06 +
			sta * 0.04;
	} else if (pos === "CB") {
		// Center Back: Def Awareness, Interceptions, Stand Tackle, Sprint Speed, Strength, Reactions
		rawMeta =
			defAw * 0.22 +
			itc * 0.20 +
			stk * 0.20 +
			spd * 0.12 +
			str * 0.10 +
			rea * 0.10 +
			com * 0.06;
	} else if (pos === "LB" || pos === "RB" || pos === "LWB" || pos === "RWB") {
		// Fullbacks: Sprint Speed, Acceleration, Standing Tackle, Interceptions, Stamina, Agility
		rawMeta =
			spd * 0.20 +
			acc * 0.18 +
			stk * 0.16 +
			itc * 0.14 +
			sta * 0.12 +
			defAw * 0.10 +
			rea * 0.06 +
			agi * 0.04;
	} else {
		// Default / GK
		rawMeta = card.overallRating;
	}

	// 3. Multipliers & Modifiers

	// A. Weak Foot Multiplier (Game-changer for attackers)
	let wfMultiplier = 1.0;
	if (pos === "ST" || pos === "CF" || pos === "CAM" || pos === "LW" || pos === "RW") {
		if (card.weakFoot === 5) wfMultiplier = 1.045; // 5* WF gives immense unpredictability
		else if (card.weakFoot === 4) wfMultiplier = 1.0;
		else if (card.weakFoot === 3) wfMultiplier = 0.94;
		else wfMultiplier = 0.86;
	}

	// B. Skill Moves Multiplier
	let smMultiplier = 1.0;
	if (pos === "ST" || pos === "CF" || pos === "CAM" || pos === "LW" || pos === "RW") {
		if (card.skillMoves === 5) smMultiplier = 1.03;
		else if (card.skillMoves === 4) smMultiplier = 1.0;
		else smMultiplier = 0.96;
	}

	const wfSmFactor = (wfMultiplier + smMultiplier) / 2;

	// C. PlayStyles & PlayStyles+ Bonus
	let playStylesBonus = 0;
	const psPlus = card.playstylesPlus ?? [];
	for (const p of psPlus) {
		if (TIER_S_PLUS.has(p)) playStylesBonus += 3.5;
		else if (TIER_A_PLUS.has(p)) playStylesBonus += 2.0;
		else playStylesBonus += 1.2;
	}

	const psReg = card.playstyles ?? [];
	for (const p of psReg) {
		if (TIER_S_REGULAR.has(p)) playStylesBonus += 0.8;
		else playStylesBonus += 0.4;
	}

	// Cap PlayStyles bonus at +8.0
	playStylesBonus = Math.min(playStylesBonus, 8.0);

	// D. AcceleRATE 2.0 Archetype Bonus
	let acceleRateBonus = 0;
	const accType = (card.accelerateType ?? "").toLowerCase();
	if (pos === "CB" || pos === "CDM" || pos === "ST") {
		if (accType.includes("lengthy")) acceleRateBonus = 2.5; // Lengthy is king over long distance
	} else if (pos === "LW" || pos === "RW" || pos === "CAM") {
		if (accType.includes("explosive")) acceleRateBonus = 2.0; // Explosive dominates small spaces
	}

	// E. Body Type Bonus
	let bodyTypeBonus = 0;
	const body = (card.bodyType ?? "").toLowerCase();
	if (body.includes("unique")) bodyTypeBonus = 2.5; // Custom animations & magnetic rebounds
	else if (body.includes("lean") && (pos === "LW" || pos === "RW" || pos === "CAM")) bodyTypeBonus = 1.5;
	else if (body.includes("stocky") && (pos === "CB" || pos === "CDM")) bodyTypeBonus = 1.5;

	// F. Composure / Reactions Floor Penalty (If composure < 80 on an attacker, heavy penalty)
	let composurePenalty = 0;
	if ((pos === "ST" || pos === "CF" || pos === "CAM") && com < 80) {
		composurePenalty = (80 - com) * 0.15;
	}

	// 4. Final Factual Meta Rating computation
	let factualMeta = rawMeta * wfSmFactor + playStylesBonus + acceleRateBonus + bodyTypeBonus - composurePenalty;
	factualMeta = Math.min(99, Math.max(45, Math.round(factualMeta * 10) / 10));

	const metaDelta = Math.round((factualMeta - card.overallRating) * 10) / 10;

	// 5. Tier assignment
	let tier: MetaTier = "C";
	if (factualMeta >= 92) tier = "S+"; // Pro tournament / God-tier
	else if (factualMeta >= 88) tier = "S"; // Weekend League Elite
	else if (factualMeta >= 84) tier = "A"; // Highly competitive
	else if (factualMeta >= 80) tier = "B"; // Decent starter squad
	else tier = "C"; // Fodder / Non-meta

	// 6. Recommended Chemistry Style
	let recommendedChemStyle: MetaRatingReport["recommendedChemStyle"] = "Basic";
	if (pos === "CB" || pos === "CDM" || pos === "LB" || pos === "RB") {
		if (card.pac < 85) recommendedChemStyle = "Shadow";
		else recommendedChemStyle = "Anchor";
	} else if (pos === "ST" || pos === "CF") {
		if (card.pac < 93) recommendedChemStyle = "Hunter";
		else recommendedChemStyle = "Hawk";
	} else if (pos === "LW" || pos === "RW" || pos === "CAM") {
		if (card.pac < 90) recommendedChemStyle = "Hunter";
		else if (card.dri < 88) recommendedChemStyle = "Engine";
		else recommendedChemStyle = "Finisher";
	}

	// 7. Qualitative Strengths & Weaknesses
	const strengths: string[] = [];
	const weaknesses: string[] = [];

	if (card.pac >= 90) strengths.push(`Pace monstre (${card.pac})`);
	if (card.weakFoot === 5) strengths.push("5★ Mauvais Pied (finition des deux pieds)");
	if (card.skillMoves === 5) strengths.push("5★ Gestes Techniques");
	if (playStylesBonus >= 3.5) strengths.push(`PlayStyles S-Tier (${psPlus.join(", ") || "Top Regulars"})`);
	if (acceleRateBonus > 0) strengths.push(`AcceleRATE optimal (${card.accelerateType})`);
	if (bodyTypeBonus >= 2.0) strengths.push(`Body Type Unique (${card.bodyType})`);

	if (card.pac < 80 && (pos === "ST" || pos === "LW" || pos === "RW" || pos === "CB")) {
		weaknesses.push(`Vitesse pénalisante pour la méta (${card.pac})`);
	}
	if (card.weakFoot <= 3 && (pos === "ST" || pos === "CAM")) {
		weaknesses.push(`Mauvais pied faible (${card.weakFoot}★) prévisible pour l'adversaire`);
	}
	if (com < 80) weaknesses.push(`Calme insuffisant (${com}) provoquant des ratés sous pression`);
	if (sta < 75 && (pos === "CM" || pos === "CDM" || pos === "LB" || pos === "RB")) {
		weaknesses.push(`Endurance trop basse (${sta}) pour tenir 90 minutes`);
	}

	return {
		name: card.name,
		position: card.position,
		faceOvr: card.overallRating,
		factualMetaRating: factualMeta,
		metaDelta,
		tier,
		archetypeSummary: {
			acceleRateBonus,
			wfSmMultiplier: Math.round(wfSmFactor * 100) / 100,
			playStylesBonus,
			bodyTypeBonus,
			composureReactionsScore: Math.round(((com + rea) / 2) * 10) / 10,
		},
		recommendedChemStyle,
		strengths,
		weaknesses,
	};
}
