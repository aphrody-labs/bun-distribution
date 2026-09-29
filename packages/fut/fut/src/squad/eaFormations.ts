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

import eaFormationsData from "../data/ea_formations.json" with { type: "json" };
import type {
	FormationDefinition,
	FormationSlotDefinition,
	PitchCoordinate,
	PitchPosition,
} from "./types.ts";

/**
 * Formations as the game itself defines them.
 *
 * `squad/formations.ts` hand-writes 7 layouts; EA ships 29, including the
 * variants players actually pick (4-3-3 (2)/(3)/(4), 4-2-3-1 (2), 4-4-2 (2),
 * 4-5-1 (2), 4-1-2-1-2 (2)), which differ in slot positions rather than in
 * name. Building them from EA's own data keeps the catalogue honest instead of
 * frozen at whatever was typed by hand.
 */

interface EaFormation {
	id: number;
	index: number;
	name: string;
	uniquePositionSlots: number[];
	generalPositionSlots: number[];
}

/**
 * FC position slot indexes (0–27) → pitch positions.
 *
 * This is the engine's slot table, NOT the player-position table used by
 * `decodeEaPosition()`. Feeding these values to that decoder silently returns
 * "CM" for anything it does not know, which turns a 4-3-3's centre-backs into
 * midfielders. Verified against 4-3-3, 4-4-2, 3-5-2 and 4-2-3-1, and it
 * resolves every slot of all 29 formations.
 */
const SLOT_POSITIONS: Readonly<Record<number, PitchPosition>> = {
	0: "GK",
	1: "CB", // sweeper
	2: "RWB",
	3: "RB",
	4: "CB", // RCB
	5: "CB",
	6: "CB", // LCB
	7: "LB",
	8: "LWB",
	9: "CDM", // RDM
	10: "CDM",
	11: "CDM", // LDM
	12: "RM",
	13: "CM", // RCM
	14: "CM",
	15: "CM", // LCM
	16: "LM",
	17: "CAM", // RAM
	18: "CAM",
	19: "CAM", // LAM
	20: "RF",
	21: "CF",
	22: "LF",
	23: "RW",
	24: "ST", // RS
	25: "ST",
	26: "ST", // LS
	27: "LW",
};

/** Positions a player may fill in a slot without being out of position. */
const INTERCHANGEABLE: Readonly<Partial<Record<PitchPosition, PitchPosition[]>>> = {
	RB: ["RB", "RWB"],
	LB: ["LB", "LWB"],
	RWB: ["RWB", "RB"],
	LWB: ["LWB", "LB"],
	CDM: ["CDM", "CM"],
	CM: ["CM", "CDM", "CAM"],
	CAM: ["CAM", "CM", "CF"],
	RM: ["RM", "RW"],
	LM: ["LM", "LW"],
	RW: ["RW", "RM", "RF"],
	LW: ["LW", "LM", "LF"],
	ST: ["ST", "CF"],
	CF: ["CF", "ST", "CAM"],
};

/** Default role and mentality per position, matching the hand-written catalogue. */
const ROLE_DEFAULTS: Readonly<
	Record<PitchPosition, { role: string; focus: FormationSlotDefinition["defaultFocus"] }>
> = {
	GK: { role: "Sweeper Keeper", focus: "Defend" },
	RB: { role: "Fullback", focus: "Defend" },
	LB: { role: "Fullback", focus: "Defend" },
	RWB: { role: "Wingback", focus: "Balanced" },
	LWB: { role: "Wingback", focus: "Balanced" },
	CB: { role: "Defender", focus: "Defend" },
	CDM: { role: "Holding", focus: "Defend" },
	CM: { role: "Box-to-Box", focus: "Balanced" },
	CAM: { role: "Playmaker", focus: "Playmaker" },
	RM: { role: "Winger", focus: "Balanced" },
	LM: { role: "Winger", focus: "Balanced" },
	RW: { role: "Inside Forward", focus: "Attack" },
	LW: { role: "Inside Forward", focus: "Attack" },
	RF: { role: "Forward", focus: "Attack" },
	LF: { role: "Forward", focus: "Attack" },
	CF: { role: "False 9", focus: "Roaming" },
	ST: { role: "Advanced Forward", focus: "Attack" },
};

/** Depth on the pitch, 90 = own goal line, 8 = opposition box. */
const DEPTH: Readonly<Record<PitchPosition, number>> = {
	GK: 90,
	CB: 76,
	RB: 72,
	LB: 72,
	RWB: 64,
	LWB: 64,
	CDM: 60,
	CM: 48,
	RM: 44,
	LM: 44,
	CAM: 34,
	RW: 26,
	LW: 26,
	RF: 20,
	LF: 20,
	CF: 18,
	ST: 12,
};

/**
 * Spreads same-position slots across the pitch width. EA's slot list is ordered
 * right to left, so index 0 of a group sits on the right.
 */
function coordinatesFor(
	position: PitchPosition,
	indexInGroup: number,
	groupSize: number,
): PitchCoordinate {
	const y = DEPTH[position] ?? 50;
	if (groupSize === 1) {
		const fixed: Partial<Record<PitchPosition, number>> = {
			RB: 88, RWB: 88, RM: 85, RW: 85, RF: 72,
			LB: 12, LWB: 12, LM: 15, LW: 15, LF: 28,
		};
		return { x: fixed[position] ?? 50, y };
	}
	// Even spread, right to left, inset from the touchlines.
	const span = position === "CB" || position === "ST" ? 46 : 60;
	const start = 50 + span / 2;
	const step = span / (groupSize - 1);
	return { x: Math.round(start - indexInGroup * step), y };
}

/** Converts one EA formation record into the package's own shape. */
export function toFormationDefinition(ea: EaFormation): FormationDefinition {
	const positions = ea.generalPositionSlots.map((slot) => {
		const p = SLOT_POSITIONS[slot];
		if (!p) {
			throw new Error(
				`Unknown FC position slot ${slot} in formation "${ea.name}" — the slot table needs updating.`,
			);
		}
		return p;
	});

	// Count how many slots share each position so they can be spread apart.
	const groupTotals = new Map<PitchPosition, number>();
	for (const p of positions) groupTotals.set(p, (groupTotals.get(p) ?? 0) + 1);
	const groupSeen = new Map<PitchPosition, number>();

	const slots: FormationSlotDefinition[] = positions.map((position, slotIndex) => {
		const seen = groupSeen.get(position) ?? 0;
		groupSeen.set(position, seen + 1);
		const defaults = ROLE_DEFAULTS[position];
		return {
			slotIndex,
			defaultPosition: position,
			allowedPositions: INTERCHANGEABLE[position] ?? [position],
			coordinates: coordinatesFor(position, seen, groupTotals.get(position) ?? 1),
			defaultRole: defaults.role,
			defaultFocus: defaults.focus,
		};
	});

	const defenders = positions.filter(
		(p) => p === "CB" || p === "RB" || p === "LB" || p === "RWB" || p === "LWB",
	).length;

	return {
		id: ea.id,
		name: ea.name,
		category:
			defenders >= 5 ? "5-at-the-back" : defenders <= 3 ? "3-at-the-back" : "4-at-the-back",
		slots,
	};
}

/** All 29 formations EA ships, keyed by name (variants keep their "(2)" suffix). */
export const EA_FORMATIONS: Record<string, FormationDefinition> = Object.fromEntries(
	(eaFormationsData as EaFormation[]).map((f) => [f.name, toFormationDefinition(f)]),
);

/** Names of every EA formation, in the game's own order. */
export function listEaFormations(): string[] {
	return (eaFormationsData as EaFormation[]).map((f) => f.name);
}

/** Looks up an EA formation by name, case-insensitively. */
export function getEaFormation(name: string): FormationDefinition | undefined {
	const key = name.trim();
	return (
		EA_FORMATIONS[key] ??
		Object.entries(EA_FORMATIONS).find(
			([n]) => n.toLowerCase() === key.toLowerCase(),
		)?.[1]
	);
}
