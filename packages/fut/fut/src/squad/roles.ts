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

import { FC27_POSITIONS } from "../data/fc27_taxonomy.ts";
import type { PitchPosition, SquadPlayerItem, SquadSlotState } from "./types.ts";

export interface TacticalBalanceAssessment {
	score: number; // 0 to 100
	hasAnchorMidfielder: boolean;
	hasCreativePlaymaker: boolean;
	hasVerticalStriker: boolean;
	hasDefensiveWidth: boolean;
	warnings: string[];
	recommendations: string[];
}

export function getRolesForPosition(position: PitchPosition): string[] {
	const pos = FC27_POSITIONS.find((p) => p.code === position);
	if (!pos) return [];
	return pos.roles.map((r) => r.name_en);
}

export function evaluatePlayerRoleTier(
	player: SquadPlayerItem,
	roleName: string,
): "base" | "plus" | "plus_plus" {
	if (player.rolesPlusPlus?.some((r) => r.toLowerCase() === roleName.toLowerCase())) {
		return "plus_plus";
	}
	if (player.rolesPlus?.some((r) => r.toLowerCase() === roleName.toLowerCase())) {
		return "plus";
	}
	return "base";
}

export function analyzeTacticalBalance(slots: SquadSlotState[]): TacticalBalanceAssessment {
	let hasAnchorMidfielder = false;
	let hasCreativePlaymaker = false;
	let hasVerticalStriker = false;
	let fullbacksAttackingCount = 0;
	const warnings: string[] = [];
	const recommendations: string[] = [];

	for (const slot of slots) {
		const role = slot.assignedRole?.toLowerCase() ?? "";
		const focus = slot.assignedFocus;
		const pos = slot.position;

		if ((pos === "CDM" || pos === "CM") && (role.includes("holding") || role.includes("sentinelle"))) {
			hasAnchorMidfielder = true;
		}

		if (role.includes("playmaker") || role.includes("meneur")) {
			hasCreativePlaymaker = true;
		}

		if ((pos === "ST" || pos === "CF") && (role.includes("advanced") || role.includes("poacher"))) {
			hasVerticalStriker = true;
		}

		if ((pos === "LB" || pos === "RB" || pos === "LWB" || pos === "RWB") && (focus === "Attack" || role.includes("wingback"))) {
			fullbacksAttackingCount++;
		}
	}

	let score = 70;

	if (hasAnchorMidfielder) {
		score += 10;
	} else {
		score -= 15;
		warnings.push("Aucun milieu défensif axial en rôle 'Holding' / Sentinelle. Risque élevé lors des transitions défensives.");
		recommendations.push("Assigner au moins un milieu central (MDC/MC) au rôle Holding avec Focus Défense.");
	}

	if (hasCreativePlaymaker) {
		score += 10;
	} else {
		recommendations.push("Intégrer un 'Playmaker' (MOC ou Deep-Lying Playmaker) pour optimiser les passes décisives axiales.");
	}

	if (hasVerticalStriker) {
		score += 10;
	} else {
		warnings.push("Pas de buteur de rupture 'Advanced Forward' ou 'Poacher' pour attaquer la profondeur.");
	}

	if (fullbacksAttackingCount >= 2 && !hasAnchorMidfielder) {
		score -= 15;
		warnings.push("Les deux latéraux attaquent sans couverture axiale de sentinelle. Couloirs vulnérables aux contres.");
	}

	return {
		score: Math.max(0, Math.min(100, score)),
		hasAnchorMidfielder,
		hasCreativePlaymaker,
		hasVerticalStriker,
		hasDefensiveWidth: fullbacksAttackingCount <= 1,
		warnings,
		recommendations,
	};
}
