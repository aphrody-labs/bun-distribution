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

export enum FrostbiteCompression {
	None = 0x0000,
	Zlib = 0x0200,
	OodleKraken = 0x0900,
	Zstd = 0x0b00,
	OodleLeviathan = 0x0f00,
}

export interface CasBlockHeader {
	decompressedSize: number;
	compressionType: FrostbiteCompression | number;
	compressedSize: number;
	payloadOffset: number;
}

export interface CatEntry {
	sha1: string; // 40-char hex string
	casIndex: number;
	offset: number;
	size: number;
}

export interface TocEntry {
	name: string;
	sha1?: string;
	offset?: number;
	size?: number;
	isCompressed?: boolean;
	superbundle?: string;
}

export interface SuperbundleToc {
	magic: string;
	bundles: Array<{
		name: string;
		offset: number;
		size: number;
	}>;
	chunks: Array<{
		guid: string;
		sha1: string;
	}>;
	ebx: Array<{
		name: string;
		sha1: string;
		originalSize: number;
	}>;
	res: Array<{
		name: string;
		sha1: string;
		resRid: string;
		resType: number;
	}>;
}

export interface EbxFieldDescriptor {
	nameHash: number;
	name?: string;
	type: number;
	offset: number;
}

export interface EbxTypeDescriptor {
	nameHash: number;
	name?: string;
	fieldCount: number;
	fields: EbxFieldDescriptor[];
	alignment: number;
	size: number;
}

export interface EbxPartition {
	guid: string;
	primaryInstanceGuid: string;
	typeCount: number;
	types: EbxTypeDescriptor[];
	instances: Array<{
		typeHash: number;
		typeName?: string;
		guid: string;
		properties: Record<string, unknown>;
	}>;
}

export interface ExtractedAssetResult {
	name: string;
	sha1: string;
	type: "ebx" | "res" | "chunk" | "raw";
	data: Uint8Array;
	decompressedSize: number;
}
