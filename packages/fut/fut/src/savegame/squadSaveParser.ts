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

export interface SquadPlayerAssignment {
	playerId: number;
	positionIndex: number; // 0 = GK, 1 = RB, ...
	shirtNumber: number;
}

export interface TeamSquadRoster {
	teamId: number;
	formationId: number;
	lineup: SquadPlayerAssignment[];
	takers: {
		captain: number;
		penaltyTaker: number;
		leftFreeKick: number;
		rightFreeKick: number;
		leftCorner: number;
		rightCorner: number;
	};
}

export interface SquadSaveData {
	magic: string; // e.g. "FCSQ"
	version: number;
	timestamp: number;
	teams: TeamSquadRoster[];
}

export class SquadSaveParser {
	public static readonly MAGIC = "FCSQ";

	/**
	 * Parses a binary Squads save file.
	 */
	public static parse(buffer: Uint8Array): SquadSaveData {
		const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

		// Read 4-byte ASCII magic
		let magic = "";
		for (let i = 0; i < 4; i++) {
			magic += String.fromCharCode(buffer[i] || 0);
		}

		let version = 1;
		let timestamp = Date.now();
		let teamCount = 0;
		let offset = 4;

		if (buffer.byteLength >= 16) {
			version = view.getUint32(offset, true);
			timestamp = Number(view.getBigUint64(offset + 4, true));
			teamCount = view.getUint32(offset + 12, true);
			offset += 16;
		}

		const teams: TeamSquadRoster[] = [];
		const safeCount = Math.min(teamCount, 256); // Safety cap

		for (let t = 0; t < safeCount; t++) {
			if (offset + 32 > buffer.byteLength) break;
			const teamId = view.getUint32(offset, true);
			const formationId = view.getUint32(offset + 4, true);
			const captain = view.getUint32(offset + 8, true);
			const penaltyTaker = view.getUint32(offset + 12, true);
			const leftFreeKick = view.getUint32(offset + 16, true);
			const rightFreeKick = view.getUint32(offset + 20, true);
			const leftCorner = view.getUint32(offset + 24, true);
			const rightCorner = view.getUint32(offset + 28, true);
			offset += 32;

			const lineup: SquadPlayerAssignment[] = [];
			for (let p = 0; p < 11; p++) {
				if (offset + 8 > buffer.byteLength) break;
				const playerId = view.getUint32(offset, true);
				const positionIndex = view.getUint16(offset + 4, true);
				const shirtNumber = view.getUint16(offset + 6, true);
				lineup.push({ playerId, positionIndex, shirtNumber });
				offset += 8;
			}

			teams.push({
				teamId,
				formationId,
				lineup,
				takers: {
					captain,
					penaltyTaker,
					leftFreeKick,
					rightFreeKick,
					leftCorner,
					rightCorner,
				},
			});
		}

		return {
			magic: magic.startsWith("FC") || magic.startsWith("DB") ? magic : SquadSaveParser.MAGIC,
			version,
			timestamp,
			teams,
		};
	}

	/**
	 * Serializes squad rosters back to a binary save buffer.
	 */
	public static serialize(data: SquadSaveData): Uint8Array {
		// Calculate byte length: 4 (magic) + 16 (header) + N * (32 + 11 * 8)
		const teamRecordSize = 32 + 11 * 8; // 120 bytes per team
		const totalSize = 20 + data.teams.length * teamRecordSize;
		const buffer = new Uint8Array(totalSize);
		const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

		// Write magic "FCSQ"
		for (let i = 0; i < 4; i++) {
			buffer[i] = data.magic.charCodeAt(i) || 0x20;
		}

		view.setUint32(4, data.version, true);
		view.setBigUint64(8, BigInt(data.timestamp), true);
		view.setUint32(16, data.teams.length, true);

		let offset = 20;
		for (const team of data.teams) {
			view.setUint32(offset, team.teamId, true);
			view.setUint32(offset + 4, team.formationId, true);
			view.setUint32(offset + 8, team.takers.captain, true);
			view.setUint32(offset + 12, team.takers.penaltyTaker, true);
			view.setUint32(offset + 16, team.takers.leftFreeKick, true);
			view.setUint32(offset + 20, team.takers.rightFreeKick, true);
			view.setUint32(offset + 24, team.takers.leftCorner, true);
			view.setUint32(offset + 28, team.takers.rightCorner, true);
			offset += 32;

			for (let i = 0; i < 11; i++) {
				const p = team.lineup[i] || { playerId: 0, positionIndex: i, shirtNumber: i + 1 };
				view.setUint32(offset, p.playerId, true);
				view.setUint16(offset + 4, p.positionIndex, true);
				view.setUint16(offset + 6, p.shirtNumber, true);
				offset += 8;
			}
		}

		return buffer;
	}
}
