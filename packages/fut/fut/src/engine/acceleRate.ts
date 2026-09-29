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

import type { AcceleRateType } from "../db/types.ts";

export interface PhysicalAttributes {
	heightCm: number;
	acceleration: number;
	agility: number;
	strength: number;
}

export class AcceleRateCalculator {
	/**
	 * Determines the exact AcceleRATE 2.0 acceleration classification
	 * in EA SPORTS FC 24/25/26/27.
	 */
	public static calculate(attrs: PhysicalAttributes): AcceleRateType {
		const { heightCm, acceleration, agility, strength } = attrs;
		const diff = strength - agility; // Positive means stronger than agile

		// 1. Pure Lengthy:
		// Strength >= 80, diff >= 14, height >= 188cm, acceleration >= 55
		if (strength >= 80 && diff >= 14 && heightCm >= 188 && acceleration >= 55) {
			return "Lengthy";
		}

		// 2. Mostly Lengthy:
		// Strength >= 74, diff >= 8, height >= 183cm, acceleration >= 60
		if (strength >= 74 && diff >= 8 && heightCm >= 183 && acceleration >= 60) {
			return "Mostly Lengthy";
		}

		// 3. Controlled Lengthy:
		// Strength >= 65, diff >= 4, height >= 180cm
		if (strength >= 65 && diff >= 4 && heightCm >= 180) {
			return "Controlled Lengthy";
		}

		// 4. Pure Explosive:
		// Agility >= 80, agility - strength >= 14, height <= 175cm, acceleration >= 80
		if (agility >= 80 && (agility - strength) >= 14 && heightCm <= 175 && acceleration >= 80) {
			return "Explosive";
		}

		// 5. Mostly Explosive:
		// Agility >= 74, agility - strength >= 8, height <= 180cm
		if (agility >= 74 && (agility - strength) >= 8 && heightCm <= 180) {
			return "Mostly Explosive";
		}

		// 6. Controlled Explosive:
		// Agility >= 65, agility - strength >= 4, height <= 182cm
		if (agility >= 65 && (agility - strength) >= 4 && heightCm <= 182) {
			return "Controlled Explosive";
		}

		// Default:
		return "Controlled";
	}
}
