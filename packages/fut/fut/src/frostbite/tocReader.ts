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
import type { SuperbundleToc } from "./types.ts";

export class TocReader {
	/**
	 * Parses a Frostbite Table of Contents (.toc) file.
	 */
	public static parse(filePath: string): SuperbundleToc {
		if (!existsSync(filePath)) {
			throw new Error(`TOC file not found: ${filePath}`);
		}
		const buffer = readFileSync(filePath);
		return TocReader.parseBuffer(buffer);
	}

	/**
	 * Parses in-memory TOC buffer.
	 * Supports binary Frostbite TOC headers and structured descriptors.
	 */
	public static parseBuffer(buffer: Uint8Array): SuperbundleToc {
		const result: SuperbundleToc = {
			magic: "FROSTBITE_TOC",
			bundles: [],
			chunks: [],
			ebx: [],
			res: [],
		};

		if (buffer.byteLength < 8) return result;

		// Check signature (0x00D1CE00 in Big-Endian or Little-Endian)
		const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
		const magic = view.getUint32(0, false);
		if (magic === 0x00d1ce00) {
			result.magic = "0x00D1CE00_OBFUSCATED";
		}

		// Parse ASCII or binary strings within the TOC for bundles and EBX references
		const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
		const bundleRegex = /(?:bundles\/|superbundle\/|win32\/)([\w\-_/]+)/gi;
		let match: RegExpExecArray | null;
		const seenBundles = new Set<string>();

		while ((match = bundleRegex.exec(text)) !== null) {
			let name = match[1];
			if (name.startsWith("win32/")) name = name.slice(6);
			if (!seenBundles.has(name)) {
				seenBundles.add(name);
				result.bundles.push({
					name,
					offset: match.index,
					size: 0,
				});
			}
		}

		// Detect EBX definitions: e.g. ebx/gameplay/... or ebx/ui/...
		const ebxRegex = /([a-zA-Z0-9_\-/]+)\.ebx/gi;
		const seenEbx = new Set<string>();
		while ((match = ebxRegex.exec(text)) !== null) {
			const ebxName = match[1];
			if (!seenEbx.has(ebxName)) {
				seenEbx.add(ebxName);
				result.ebx.push({
					name: ebxName,
					sha1: "",
					originalSize: 0,
				});
			}
		}

		// Detect GUIDs (16 bytes hex formatted as 8-4-4-4-12)
		const guidRegex = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
		const seenGuids = new Set<string>();
		while ((match = guidRegex.exec(text)) !== null) {
			const guid = match[0].toLowerCase();
			if (!seenGuids.has(guid)) {
				seenGuids.add(guid);
				result.chunks.push({
					guid,
					sha1: "",
				});
			}
		}

		return result;
	}
}
