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

import manifestData from "../data/frostbite_asset_manifest.json" with { type: "json" };

/**
 * Catalogue of the reference screen captures the design system was derived
 * from, named after EA's Frostbite blueprint conventions.
 *
 * The captures themselves live outside the published package; this manifest is
 * what travels with it, so the screen each token and card shell came from stays
 * traceable.
 */

/** One captured screen, classified against its Frostbite partition. */
export interface FrostbiteAsset {
	filename: string;
	frostbiteCodeName: string;
	ebxPartition: string;
	screenLayoutId: string;
	category: string;
	subSystem: string;
	resolution?: string;
	description?: string;
	/** Entities read off the screen (cards, prices, codes) — capture-specific. */
	extractedEntities?: Record<string, unknown>;
	/** Colours and surfaces measured on the capture. */
	designTokens?: Record<string, unknown>;
}

export interface FrostbiteAssetManifest {
	version: string;
	engine: string;
	gameSku: string;
	generatedAt: string;
	totalAssets: number;
	assets: FrostbiteAsset[];
}

export const FROSTBITE_ASSET_MANIFEST = manifestData as FrostbiteAssetManifest;

/** Every catalogued capture. */
export function listFrostbiteAssets(): FrostbiteAsset[] {
	return FROSTBITE_ASSET_MANIFEST.assets;
}

/** Captures belonging to one category, e.g. `PACK_OPENING`. Case-insensitive. */
export function getFrostbiteAssetsByCategory(category: string): FrostbiteAsset[] {
	const wanted = category.toLowerCase();
	return FROSTBITE_ASSET_MANIFEST.assets.filter(
		(a) => a.category.toLowerCase() === wanted,
	);
}

/** Looks up one capture by its Frostbite code name or its file name. */
export function getFrostbiteAsset(name: string): FrostbiteAsset | undefined {
	const wanted = name.toLowerCase().replace(/\.png$/, "");
	return FROSTBITE_ASSET_MANIFEST.assets.find(
		(a) =>
			a.frostbiteCodeName.toLowerCase() === wanted ||
			a.filename.toLowerCase().replace(/\.png$/, "") === wanted,
	);
}

/** The categories present, with how many captures each holds. */
export function frostbiteAssetCategories(): Array<{ category: string; count: number }> {
	const counts = new Map<string, number>();
	for (const a of FROSTBITE_ASSET_MANIFEST.assets) {
		counts.set(a.category, (counts.get(a.category) ?? 0) + 1);
	}
	return [...counts.entries()]
		.map(([category, count]) => ({ category, count }))
		.toSorted((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}
