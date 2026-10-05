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

import { openSync, readSync, closeSync } from "node:fs";
import { OodleDecompressor } from "./oodle.ts";
import type { CasBlockHeader } from "./types.ts";

export class CasReader {
	private decompressor: OodleDecompressor;

	constructor() {
		this.decompressor = OodleDecompressor.getInstance();
	}

	/**
	 * Parse the 8-byte standard Frostbite chunk header.
	 */
	public parseHeader(buffer: Uint8Array, offset = 0): CasBlockHeader {
		const view = new DataView(buffer.buffer, buffer.byteOffset + offset, 8);
		const decompressedSize = view.getUint32(0, false); // Big-Endian
		const compressionType = view.getUint16(4, false); // Big-Endian
		const compressedSize = view.getUint16(6, false); // Big-Endian

		return {
			decompressedSize,
			compressionType,
			compressedSize,
			payloadOffset: offset + 8,
		};
	}

	/**
	 * Decompresses a single CAS block from in-memory bytes.
	 */
	public readBlock(buffer: Uint8Array, offset = 0): { data: Uint8Array; nextOffset: number } {
		const header = this.parseHeader(buffer, offset);
		const payload = buffer.subarray(
			header.payloadOffset,
			header.payloadOffset + header.compressedSize,
		);

		const decompressed = this.decompressor.decompress(
			payload,
			header.decompressedSize,
			header.compressionType,
		);

		return {
			data: decompressed,
			nextOffset: header.payloadOffset + header.compressedSize,
		};
	}

	/**
	 * Reads an entire multi-block chunk stream from a CAS file.
	 */
	public readChunk(filePath: string, offset: number, totalCompressedSize: number): Uint8Array {
		const fd = openSync(filePath, "r");
		try {
			const buffer = new Uint8Array(totalCompressedSize);
			readSync(fd, buffer, 0, totalCompressedSize, offset);

			const chunks: Uint8Array[] = [];
			let curOffset = 0;
			let totalDecompBytes = 0;

			while (curOffset < buffer.byteLength) {
				if (buffer.byteLength - curOffset < 8) break;
				const block = this.readBlock(buffer, curOffset);
				chunks.push(block.data);
				totalDecompBytes += block.data.byteLength;
				curOffset = block.nextOffset;
			}

			if (chunks.length === 1) {
				return chunks[0];
			}

			const merged = new Uint8Array(totalDecompBytes);
			let writeOffset = 0;
			for (const chunk of chunks) {
				merged.set(chunk, writeOffset);
				writeOffset += chunk.byteLength;
			}
			return merged;
		} finally {
			closeSync(fd);
		}
	}
}
