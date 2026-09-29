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

import type { EbxPartition, EbxTypeDescriptor } from "./types.ts";

export class EbxParser {
	/**
	 * Parses a binary EBX partition buffer into a typed EbxPartition structure.
	 */
	public static parse(buffer: Uint8Array): EbxPartition {
		const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

		// Read 16-byte Partition GUID
		const partitionGuid = EbxParser.readGuid(buffer, 0);

		// Read 16-byte Primary Instance GUID
		const primaryInstanceGuid = buffer.byteLength >= 32
			? EbxParser.readGuid(buffer, 16)
			: partitionGuid;

		let typeCount = 0;
		const types: EbxTypeDescriptor[] = [];
		const instances: EbxPartition["instances"] = [];

		if (buffer.byteLength >= 36) {
			typeCount = view.getUint32(32, true);
			let offset = 36;

			// Parse up to typeCount descriptors if space permits
			const maxTypes = Math.min(typeCount, Math.floor((buffer.byteLength - offset) / 16));
			for (let i = 0; i < maxTypes; i++) {
				if (offset + 16 > buffer.byteLength) break;
				const nameHash = view.getUint32(offset, true);
				const fieldCount = view.getUint16(offset + 4, true);
				const alignment = view.getUint8(offset + 6);
				const size = view.getUint32(offset + 8, true);

				types.push({
					nameHash,
					fieldCount,
					fields: [],
					alignment,
					size,
				});
				offset += 16;
			}
		}

		// Look for instance records (each starting with a 16-byte instance GUID + 4-byte type hash)
		let scanOffset = 36 + types.length * 16;
		while (scanOffset + 20 <= buffer.byteLength) {
			const instGuid = EbxParser.readGuid(buffer, scanOffset);
			const typeHash = view.getUint32(scanOffset + 16, true);

			instances.push({
				guid: instGuid,
				typeHash,
				properties: {},
			});
			scanOffset += 32; // Jump to next probable instance boundary
			if (instances.length >= 64) break; // Limit scanning to reasonable partition bounds
		}

		return {
			guid: partitionGuid,
			primaryInstanceGuid,
			typeCount,
			types,
			instances,
		};
	}

	public static readGuid(buffer: Uint8Array, offset: number): string {
		if (offset + 16 > buffer.byteLength) {
			return "00000000-0000-0000-0000-000000000000";
		}
		const hex = Array.from(buffer.subarray(offset, offset + 16))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");

		return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
	}
}
