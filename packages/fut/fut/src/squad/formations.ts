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

import { getEaFormation, listEaFormations } from "./eaFormations.ts";
import type { FormationDefinition } from "./types.ts";

export const FORMATIONS_CATALOG: Record<string, FormationDefinition> = {
	"4-4-1-1": {
		id: 4411,
		name: "4-4-1-1",
		category: "4-at-the-back",
		slots: [
			{
				slotIndex: 0,
				defaultPosition: "GK",
				allowedPositions: ["GK"],
				coordinates: { x: 50, y: 90 },
				defaultRole: "Sweeper Keeper",
				defaultFocus: "Defend",
			},
			{
				slotIndex: 1,
				defaultPosition: "RB",
				allowedPositions: ["RB", "RWB"],
				coordinates: { x: 88, y: 72 },
				defaultRole: "Fullback",
				defaultFocus: "Defend",
			},
			{
				slotIndex: 2,
				defaultPosition: "CB",
				allowedPositions: ["CB"],
				coordinates: { x: 65, y: 76 },
				defaultRole: "Defender",
				defaultFocus: "Defend",
			},
			{
				slotIndex: 3,
				defaultPosition: "CB",
				allowedPositions: ["CB"],
				coordinates: { x: 35, y: 76 },
				defaultRole: "Defender",
				defaultFocus: "Defend",
			},
			{
				slotIndex: 4,
				defaultPosition: "LB",
				allowedPositions: ["LB", "LWB"],
				coordinates: { x: 12, y: 72 },
				defaultRole: "Fullback",
				defaultFocus: "Defend",
			},
			{
				slotIndex: 5,
				defaultPosition: "RM",
				allowedPositions: ["RM", "RW"],
				coordinates: { x: 88, y: 45 },
				defaultRole: "Inside Forward",
				defaultFocus: "Attack",
			},
			{
				slotIndex: 6,
				defaultPosition: "CM",
				allowedPositions: ["CM", "CDM"],
				coordinates: { x: 62, y: 52 },
				defaultRole: "Holding",
				defaultFocus: "Defend",
			},
			{
				slotIndex: 7,
				defaultPosition: "CM",
				allowedPositions: ["CM", "CAM"],
				coordinates: { x: 38, y: 52 },
				defaultRole: "Box-to-Box",
				defaultFocus: "Balanced",
			},
			{
				slotIndex: 8,
				defaultPosition: "LM",
				allowedPositions: ["LM", "LW"],
				coordinates: { x: 12, y: 45 },
				defaultRole: "Inside Forward",
				defaultFocus: "Attack",
			},
			{
				slotIndex: 9,
				defaultPosition: "CAM",
				allowedPositions: ["CAM", "CF", "ST"],
				coordinates: { x: 50, y: 30 },
				defaultRole: "Shadow Striker",
				defaultFocus: "Attack",
			},
			{
				slotIndex: 10,
				defaultPosition: "ST",
				allowedPositions: ["ST", "CF"],
				coordinates: { x: 50, y: 12 },
				defaultRole: "Advanced Forward",
				defaultFocus: "Attack",
			},
		],
	},

	"4-4-2": {
		id: 442,
		name: "4-4-2",
		category: "4-at-the-back",
		slots: [
			{
				slotIndex: 0,
				defaultPosition: "GK",
				allowedPositions: ["GK"],
				coordinates: { x: 50, y: 90 },
				defaultRole: "Sweeper Keeper",
				defaultFocus: "Defend",
			},
			{
				slotIndex: 1,
				defaultPosition: "RB",
				allowedPositions: ["RB", "RWB"],
				coordinates: { x: 88, y: 72 },
				defaultRole: "Fullback",
				defaultFocus: "Defend",
			},
			{
				slotIndex: 2,
				defaultPosition: "CB",
				allowedPositions: ["CB"],
				coordinates: { x: 65, y: 76 },
				defaultRole: "Defender",
				defaultFocus: "Defend",
			},
			{
				slotIndex: 3,
				defaultPosition: "CB",
				allowedPositions: ["CB"],
				coordinates: { x: 35, y: 76 },
				defaultRole: "Defender",
				defaultFocus: "Defend",
			},
			{
				slotIndex: 4,
				defaultPosition: "LB",
				allowedPositions: ["LB", "LWB"],
				coordinates: { x: 12, y: 72 },
				defaultRole: "Fullback",
				defaultFocus: "Defend",
			},
			{
				slotIndex: 5,
				defaultPosition: "RM",
				allowedPositions: ["RM", "RW"],
				coordinates: { x: 88, y: 48 },
				defaultRole: "Inside Forward",
				defaultFocus: "Attack",
			},
			{
				slotIndex: 6,
				defaultPosition: "CM",
				allowedPositions: ["CM", "CDM"],
				coordinates: { x: 62, y: 52 },
				defaultRole: "Holding",
				defaultFocus: "Defend",
			},
			{
				slotIndex: 7,
				defaultPosition: "CM",
				allowedPositions: ["CM"],
				coordinates: { x: 38, y: 52 },
				defaultRole: "Box-to-Box",
				defaultFocus: "Balanced",
			},
			{
				slotIndex: 8,
				defaultPosition: "LM",
				allowedPositions: ["LM", "LW"],
				coordinates: { x: 12, y: 48 },
				defaultRole: "Inside Forward",
				defaultFocus: "Attack",
			},
			{
				slotIndex: 9,
				defaultPosition: "ST",
				allowedPositions: ["ST", "CF"],
				coordinates: { x: 62, y: 15 },
				defaultRole: "Advanced Forward",
				defaultFocus: "Attack",
			},
			{
				slotIndex: 10,
				defaultPosition: "ST",
				allowedPositions: ["ST", "CF"],
				coordinates: { x: 38, y: 15 },
				defaultRole: "Poacher",
				defaultFocus: "Attack",
			},
		],
	},

	"4-2-1-3": {
		id: 4213,
		name: "4-2-1-3",
		category: "4-at-the-back",
		slots: [
			{
				slotIndex: 0,
				defaultPosition: "GK",
				allowedPositions: ["GK"],
				coordinates: { x: 50, y: 90 },
				defaultRole: "Sweeper Keeper",
				defaultFocus: "Defend",
			},
			{
				slotIndex: 1,
				defaultPosition: "RB",
				allowedPositions: ["RB", "RWB"],
				coordinates: { x: 88, y: 72 },
				defaultRole: "Fullback",
				defaultFocus: "Defend",
			},
			{
				slotIndex: 2,
				defaultPosition: "CB",
				allowedPositions: ["CB"],
				coordinates: { x: 65, y: 76 },
				defaultRole: "Defender",
				defaultFocus: "Defend",
			},
			{
				slotIndex: 3,
				defaultPosition: "CB",
				allowedPositions: ["CB"],
				coordinates: { x: 35, y: 76 },
				defaultRole: "Defender",
				defaultFocus: "Defend",
			},
			{
				slotIndex: 4,
				defaultPosition: "LB",
				allowedPositions: ["LB", "LWB"],
				coordinates: { x: 12, y: 72 },
				defaultRole: "Fullback",
				defaultFocus: "Defend",
			},
			{
				slotIndex: 5,
				defaultPosition: "CDM",
				allowedPositions: ["CDM", "CM"],
				coordinates: { x: 65, y: 58 },
				defaultRole: "Holding",
				defaultFocus: "Defend",
			},
			{
				slotIndex: 6,
				defaultPosition: "CDM",
				allowedPositions: ["CDM", "CM"],
				coordinates: { x: 35, y: 58 },
				defaultRole: "Deep-Lying Playmaker",
				defaultFocus: "Defend",
			},
			{
				slotIndex: 7,
				defaultPosition: "CAM",
				allowedPositions: ["CAM", "CM", "CF"],
				coordinates: { x: 50, y: 38 },
				defaultRole: "Playmaker",
				defaultFocus: "Attack",
			},
			{
				slotIndex: 8,
				defaultPosition: "RW",
				allowedPositions: ["RW", "RM"],
				coordinates: { x: 88, y: 22 },
				defaultRole: "Inside Forward",
				defaultFocus: "Attack",
			},
			{
				slotIndex: 9,
				defaultPosition: "LW",
				allowedPositions: ["LW", "LM"],
				coordinates: { x: 12, y: 22 },
				defaultRole: "Inside Forward",
				defaultFocus: "Attack",
			},
			{
				slotIndex: 10,
				defaultPosition: "ST",
				allowedPositions: ["ST", "CF"],
				coordinates: { x: 50, y: 12 },
				defaultRole: "Advanced Forward",
				defaultFocus: "Attack",
			},
		],
	},

	"4-3-3": {
		id: 433,
		name: "4-3-3",
		category: "4-at-the-back",
		slots: [
			{ slotIndex: 0, defaultPosition: "GK", allowedPositions: ["GK"], coordinates: { x: 50, y: 90 }, defaultRole: "Sweeper Keeper", defaultFocus: "Defend" },
			{ slotIndex: 1, defaultPosition: "RB", allowedPositions: ["RB", "RWB"], coordinates: { x: 88, y: 72 }, defaultRole: "Fullback", defaultFocus: "Defend" },
			{ slotIndex: 2, defaultPosition: "CB", allowedPositions: ["CB"], coordinates: { x: 65, y: 76 }, defaultRole: "Defender", defaultFocus: "Defend" },
			{ slotIndex: 3, defaultPosition: "CB", allowedPositions: ["CB"], coordinates: { x: 35, y: 76 }, defaultRole: "Defender", defaultFocus: "Defend" },
			{ slotIndex: 4, defaultPosition: "LB", allowedPositions: ["LB", "LWB"], coordinates: { x: 12, y: 72 }, defaultRole: "Fullback", defaultFocus: "Defend" },
			{ slotIndex: 5, defaultPosition: "CM", allowedPositions: ["CM", "CDM"], coordinates: { x: 72, y: 50 }, defaultRole: "Box-to-Box", defaultFocus: "Balanced" },
			{ slotIndex: 6, defaultPosition: "CM", allowedPositions: ["CM", "CDM"], coordinates: { x: 50, y: 54 }, defaultRole: "Holding", defaultFocus: "Defend" },
			{ slotIndex: 7, defaultPosition: "CM", allowedPositions: ["CM", "CAM"], coordinates: { x: 28, y: 50 }, defaultRole: "Playmaker", defaultFocus: "Attack" },
			{ slotIndex: 8, defaultPosition: "RW", allowedPositions: ["RW", "RM"], coordinates: { x: 88, y: 22 }, defaultRole: "Inside Forward", defaultFocus: "Attack" },
			{ slotIndex: 9, defaultPosition: "LW", allowedPositions: ["LW", "LM"], coordinates: { x: 12, y: 22 }, defaultRole: "Inside Forward", defaultFocus: "Attack" },
			{ slotIndex: 10, defaultPosition: "ST", allowedPositions: ["ST", "CF"], coordinates: { x: 50, y: 12 }, defaultRole: "Advanced Forward", defaultFocus: "Attack" },
		],
	},

	"4-2-3-1": {
		id: 4231,
		name: "4-2-3-1",
		category: "4-at-the-back",
		slots: [
			{ slotIndex: 0, defaultPosition: "GK", allowedPositions: ["GK"], coordinates: { x: 50, y: 90 }, defaultRole: "Sweeper Keeper", defaultFocus: "Defend" },
			{ slotIndex: 1, defaultPosition: "RB", allowedPositions: ["RB"], coordinates: { x: 88, y: 72 }, defaultRole: "Fullback", defaultFocus: "Defend" },
			{ slotIndex: 2, defaultPosition: "CB", allowedPositions: ["CB"], coordinates: { x: 65, y: 76 }, defaultRole: "Defender", defaultFocus: "Defend" },
			{ slotIndex: 3, defaultPosition: "CB", allowedPositions: ["CB"], coordinates: { x: 35, y: 76 }, defaultRole: "Defender", defaultFocus: "Defend" },
			{ slotIndex: 4, defaultPosition: "LB", allowedPositions: ["LB"], coordinates: { x: 12, y: 72 }, defaultRole: "Fullback", defaultFocus: "Defend" },
			{ slotIndex: 5, defaultPosition: "CDM", allowedPositions: ["CDM", "CM"], coordinates: { x: 65, y: 58 }, defaultRole: "Holding", defaultFocus: "Defend" },
			{ slotIndex: 6, defaultPosition: "CDM", allowedPositions: ["CDM", "CM"], coordinates: { x: 35, y: 58 }, defaultRole: "Deep-Lying Playmaker", defaultFocus: "Defend" },
			{ slotIndex: 7, defaultPosition: "CAM", allowedPositions: ["CAM", "RW", "RM"], coordinates: { x: 78, y: 35 }, defaultRole: "Inside Forward", defaultFocus: "Attack" },
			{ slotIndex: 8, defaultPosition: "CAM", allowedPositions: ["CAM"], coordinates: { x: 50, y: 33 }, defaultRole: "Playmaker", defaultFocus: "Attack" },
			{ slotIndex: 9, defaultPosition: "CAM", allowedPositions: ["CAM", "LW", "LM"], coordinates: { x: 22, y: 35 }, defaultRole: "Inside Forward", defaultFocus: "Attack" },
			{ slotIndex: 10, defaultPosition: "ST", allowedPositions: ["ST", "CF"], coordinates: { x: 50, y: 12 }, defaultRole: "Advanced Forward", defaultFocus: "Attack" },
		],
	},

	"3-5-2": {
		id: 352,
		name: "3-5-2",
		category: "3-at-the-back",
		slots: [
			{ slotIndex: 0, defaultPosition: "GK", allowedPositions: ["GK"], coordinates: { x: 50, y: 90 }, defaultRole: "Sweeper Keeper", defaultFocus: "Defend" },
			{ slotIndex: 1, defaultPosition: "CB", allowedPositions: ["CB"], coordinates: { x: 75, y: 75 }, defaultRole: "Defender", defaultFocus: "Defend" },
			{ slotIndex: 2, defaultPosition: "CB", allowedPositions: ["CB"], coordinates: { x: 50, y: 78 }, defaultRole: "Defender", defaultFocus: "Defend" },
			{ slotIndex: 3, defaultPosition: "CB", allowedPositions: ["CB"], coordinates: { x: 25, y: 75 }, defaultRole: "Defender", defaultFocus: "Defend" },
			{ slotIndex: 4, defaultPosition: "CDM", allowedPositions: ["CDM", "CM"], coordinates: { x: 65, y: 58 }, defaultRole: "Holding", defaultFocus: "Defend" },
			{ slotIndex: 5, defaultPosition: "CDM", allowedPositions: ["CDM", "CM"], coordinates: { x: 35, y: 58 }, defaultRole: "Holding", defaultFocus: "Defend" },
			{ slotIndex: 6, defaultPosition: "RM", allowedPositions: ["RM", "RWB", "RW"], coordinates: { x: 90, y: 45 }, defaultRole: "Wide Midfielder", defaultFocus: "Balanced" },
			{ slotIndex: 7, defaultPosition: "LM", allowedPositions: ["LM", "LWB", "LW"], coordinates: { x: 10, y: 45 }, defaultRole: "Wide Midfielder", defaultFocus: "Balanced" },
			{ slotIndex: 8, defaultPosition: "CAM", allowedPositions: ["CAM", "CF"], coordinates: { x: 50, y: 35 }, defaultRole: "Playmaker", defaultFocus: "Attack" },
			{ slotIndex: 9, defaultPosition: "ST", allowedPositions: ["ST", "CF"], coordinates: { x: 65, y: 14 }, defaultRole: "Advanced Forward", defaultFocus: "Attack" },
			{ slotIndex: 10, defaultPosition: "ST", allowedPositions: ["ST", "CF"], coordinates: { x: 35, y: 14 }, defaultRole: "Poacher", defaultFocus: "Attack" },
		],
	},

	"5-3-2": {
		id: 532,
		name: "5-3-2",
		category: "5-at-the-back",
		slots: [
			{ slotIndex: 0, defaultPosition: "GK", allowedPositions: ["GK"], coordinates: { x: 50, y: 90 }, defaultRole: "Sweeper Keeper", defaultFocus: "Defend" },
			{ slotIndex: 1, defaultPosition: "RWB", allowedPositions: ["RWB", "RB"], coordinates: { x: 90, y: 68 }, defaultRole: "Wingback", defaultFocus: "Balanced" },
			{ slotIndex: 2, defaultPosition: "CB", allowedPositions: ["CB"], coordinates: { x: 70, y: 77 }, defaultRole: "Defender", defaultFocus: "Defend" },
			{ slotIndex: 3, defaultPosition: "CB", allowedPositions: ["CB"], coordinates: { x: 50, y: 80 }, defaultRole: "Defender", defaultFocus: "Defend" },
			{ slotIndex: 4, defaultPosition: "CB", allowedPositions: ["CB"], coordinates: { x: 30, y: 77 }, defaultRole: "Defender", defaultFocus: "Defend" },
			{ slotIndex: 5, defaultPosition: "LWB", allowedPositions: ["LWB", "LB"], coordinates: { x: 10, y: 68 }, defaultRole: "Wingback", defaultFocus: "Balanced" },
			{ slotIndex: 6, defaultPosition: "CM", allowedPositions: ["CM", "CDM"], coordinates: { x: 68, y: 50 }, defaultRole: "Box-to-Box", defaultFocus: "Balanced" },
			{ slotIndex: 7, defaultPosition: "CM", allowedPositions: ["CM", "CDM"], coordinates: { x: 50, y: 54 }, defaultRole: "Holding", defaultFocus: "Defend" },
			{ slotIndex: 8, defaultPosition: "CM", allowedPositions: ["CM", "CAM"], coordinates: { x: 32, y: 50 }, defaultRole: "Playmaker", defaultFocus: "Attack" },
			{ slotIndex: 9, defaultPosition: "ST", allowedPositions: ["ST", "CF"], coordinates: { x: 62, y: 15 }, defaultRole: "Advanced Forward", defaultFocus: "Attack" },
			{ slotIndex: 10, defaultPosition: "ST", allowedPositions: ["ST", "CF"], coordinates: { x: 38, y: 15 }, defaultRole: "Advanced Forward", defaultFocus: "Attack" },
		],
	},
};

/**
 * Looks up a formation. The hand-written catalogue above wins when it has an
 * entry (its coordinates and roles are tuned); otherwise the layout is built
 * from EA's own formation data, which covers all 29 the game ships —
 * including the variants that share a name, like "4-3-3 (2)".
 */
export function getFormation(name: string): FormationDefinition {
	const found = FORMATIONS_CATALOG[name] ?? getEaFormation(name);
	if (!found) {
		const available = listFormations().join(", ");
		throw new Error(`Unknown formation "${name}". Available formations: ${available}`);
	}
	return found;
}

/** Every formation available: the tuned ones plus everything EA ships. */
export function listFormations(): string[] {
	return [
		...new Set([...Object.keys(FORMATIONS_CATALOG), ...listEaFormations()]),
	];
}
