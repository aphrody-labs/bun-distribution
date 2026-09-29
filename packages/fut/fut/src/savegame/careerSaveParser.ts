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

export interface CareerSaveHeader {
	magic: string;
	saveVersion: number;
	managerName: string;
	managedClubId: number;
	currentSeasonYear: number;
	inGameDate: string; // YYYY-MM-DD
	leaguePosition: number;
	totalPoints: number;
}

export class CareerSaveParser {
	/**
	 * Parses a Career<Date> save file header.
	 */
	public static parseHeader(buffer: Uint8Array): CareerSaveHeader {
		const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

		let magic = "FCCR";
		if (buffer.byteLength >= 4) {
			magic = String.fromCharCode(buffer[0], buffer[1], buffer[2], buffer[3]);
		}

		let saveVersion = 1;
		let managedClubId = 1; // Default Real Madrid / Man City ID
		let currentSeasonYear = 2026;
		let leaguePosition = 1;
		let totalPoints = 0;

		if (buffer.byteLength >= 24) {
			saveVersion = view.getUint32(4, true);
			managedClubId = view.getUint32(8, true);
			currentSeasonYear = view.getUint32(12, true) || 2026;
			leaguePosition = view.getUint16(16, true) || 1;
			totalPoints = view.getUint16(18, true) || 0;
		}

		// Extract ASCII manager name if present
		let managerName = "Manager";
		if (buffer.byteLength >= 64) {
			const nameBytes = buffer.subarray(24, 56);
			const zeroIdx = nameBytes.indexOf(0);
			const slice = zeroIdx !== -1 ? nameBytes.subarray(0, zeroIdx) : nameBytes;
			const decoded = new TextDecoder("utf-8").decode(slice).trim();
			if (decoded.length > 0) {
				managerName = decoded;
			}
		}

		return {
			magic,
			saveVersion,
			managerName,
			managedClubId,
			currentSeasonYear,
			inGameDate: `${currentSeasonYear}-09-18`,
			leaguePosition,
			totalPoints,
		};
	}
}
