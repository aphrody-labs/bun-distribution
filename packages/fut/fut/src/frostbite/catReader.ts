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

import { readFileSync, existsSync } from "node:fs";
import type { CatEntry } from "./types.ts";

export class CatReader {
	private entries: Map<string, CatEntry> = new Map();

	constructor(catFilePath?: string) {
		if (catFilePath && existsSync(catFilePath)) {
			this.load(catFilePath);
		}
	}

	/**
	 * Loads and parses a binary Frostbite cas.cat catalog.
	 */
	public load(filePath: string): number {
		const buffer = readFileSync(filePath);
		return this.parseBuffer(buffer);
	}

	/**
	 * Parses in-memory buffer of a cas.cat file.
	 * Standard CAT entry structure is 32 bytes:
	 * - 20 bytes: SHA-1 hash
	 * - 4 bytes: Offset in CAS (Little-Endian / Big-Endian depending on build, typically LE in Win64)
	 * - 4 bytes: Size in CAS
	 * - 4 bytes: CAS file number (cas_01.cas = 1)
	 */
	public parseBuffer(buffer: Uint8Array): number {
		this.entries.clear();
		const ENTRY_SIZE = 32;
		const count = Math.floor(buffer.byteLength / ENTRY_SIZE);
		const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

		for (let i = 0; i < count; i++) {
			const base = i * ENTRY_SIZE;
			// 20-byte SHA-1
			const sha1Bytes = buffer.subarray(base, base + 20);
			let sha1 = "";
			for (let b = 0; b < 20; b++) {
				sha1 += sha1Bytes[b].toString(16).padStart(2, "0");
			}

			const offset = view.getUint32(base + 20, true);
			const size = view.getUint32(base + 24, true);
			const casIndex = view.getUint32(base + 28, true);

			this.entries.set(sha1, {
				sha1,
				offset,
				size,
				casIndex,
			});
		}

		return this.entries.size;
	}

	public get(sha1: string): CatEntry | undefined {
		return this.entries.get(sha1.toLowerCase());
	}

	public has(sha1: string): boolean {
		return this.entries.has(sha1.toLowerCase());
	}

	public get count(): number {
		return this.entries.size;
	}

	public getAll(): CatEntry[] {
		return Array.from(this.entries.values());
	}
}
