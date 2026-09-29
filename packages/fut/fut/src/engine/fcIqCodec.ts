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

import type { BuildUpPlayStyle, DefensiveApproach, FcIqTacticalSetup, PlayerRoleAssignment, RoleFocus } from "./types.ts";

export class FcIqCodec {
	private static readonly BUILD_UP_MAP: BuildUpPlayStyle[] = [
		"ShortPassing",
		"Balanced",
		"DirectPassing",
		"LongBall",
	];

	private static readonly DEFENSE_MAP: DefensiveApproach[] = [
		"Deep",
		"Balanced",
		"HighPress",
		"Aggressive",
	];

	private static readonly FOCUS_MAP: RoleFocus[] = [
		"Defend",
		"Balanced",
		"Attack",
		"Roaming",
	];

	/**
	 * Encodes a tactical setup into a compact base64url string.
	 */
	public static encode(setup: FcIqTacticalSetup): string {
		const payload = {
			f: setup.formationId,
			b: FcIqCodec.BUILD_UP_MAP.indexOf(setup.buildUpStyle),
			d: FcIqCodec.DEFENSE_MAP.indexOf(setup.defensiveApproach),
			l: setup.defensiveLineDepth,
			r: setup.roles.map((r) => [
				r.slotIndex,
				r.position,
				r.roleId,
				FcIqCodec.FOCUS_MAP.indexOf(r.focus),
			]),
		};

		const json = JSON.stringify(payload);
		const base64 = Buffer.from(json, "utf-8")
			.toString("base64url")
			.replace(/=/g, "");
		return `fciq_${base64}`;
	}

	/**
	 * Decodes an encoded tactical code back into an FcIqTacticalSetup object.
	 */
	public static decode(code: string): FcIqTacticalSetup {
		let cleanCode = code.trim();
		if (cleanCode.startsWith("fciq_")) {
			cleanCode = cleanCode.slice(5);
		}

		try {
			const json = Buffer.from(cleanCode, "base64url").toString("utf-8");
			const parsed = JSON.parse(json);

			const roles: PlayerRoleAssignment[] = (parsed.r || []).map((raw: any) => ({
				slotIndex: raw[0],
				position: raw[1],
				roleId: raw[2],
				focus: FcIqCodec.FOCUS_MAP[raw[3]] || "Balanced",
			}));

			return {
				formationId: parsed.f || "4-3-3",
				buildUpStyle: FcIqCodec.BUILD_UP_MAP[parsed.b] || "Balanced",
				defensiveApproach: FcIqCodec.DEFENSE_MAP[parsed.d] || "Balanced",
				defensiveLineDepth: parsed.l ?? 50,
				roles,
			};
		} catch {
			throw new Error(`Invalid FC IQ tactical code format: "${code}"`);
		}
	}

	/**
	 * Validates tactical setup rules (11 players, unique slots 0-10, valid line depth).
	 */
	public static validate(setup: FcIqTacticalSetup): boolean {
		if (setup.defensiveLineDepth < 1 || setup.defensiveLineDepth > 100) return false;
		if (!setup.formationId) return false;
		if (setup.roles.length !== 11) return false;

		const slots = new Set(setup.roles.map((r) => r.slotIndex));
		return slots.size === 11;
	}
}
