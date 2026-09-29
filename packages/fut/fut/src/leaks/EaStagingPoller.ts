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

export interface EaStagingBuildInfo {
	guid: string;
	timestamp: string;
	year: string;
	activeUrl: string;
	etag?: string;
	lastModified?: string;
}

export interface LeakedEntity {
	type: "PROMO" | "PLAYER" | "SBC" | "PACK" | "EVOLUTION";
	identifier: string;
	displayName: string;
	description?: string;
	stagedAt: string;
	source: "LOC_DIFF" | "ETAG_STAGING" | "CONTENT_API" | "PACK_CODE";
	metadata?: Record<string, unknown>;
}

export interface StagingDiffResult {
	hasChanged: boolean;
	previousEtag?: string;
	currentEtag?: string;
	newEntities: LeakedEntity[];
}

/**
 * High-performance poller & diffing engine for EA Sports FC CDN staging buckets,
 * localization dictionaries, and pack definitions.
 */
export class EaStagingPoller {
	private knownEtags: Map<string, string> = new Map();
	private knownLocKeys: Set<string> = new Set();
	private stagedLeaksStore: LeakedEntity[] = [];

	constructor() {
		this.seedBaselineEntities();
	}

	private seedBaselineEntities(): void {
		this.stagedLeaksStore = [
			{
				type: "PLAYER",
				identifier: "p_27_mbappe_trailblazers",
				displayName: "Kylian Mbappé (Trailblazers)",
				description: "93 ST with Quick Step+ and Rapid+ staged on Akamai edge",
				stagedAt: "2026-09-17T09:00:00Z",
				source: "ETAG_STAGING",
				metadata: { rating: 93, position: "ST", club: "Real Madrid" },
			},
			{
				type: "PLAYER",
				identifier: "p_27_bellingham_rttk",
				displayName: "Jude Bellingham (RTTK)",
				description: "91 CAM with Relentless+ and Technical+ staged in PC TU diff",
				stagedAt: "2026-09-17T08:30:00Z",
				source: "LOC_DIFF",
				metadata: { rating: 91, position: "CAM", club: "Real Madrid" },
			},
			{
				type: "PROMO",
				identifier: "EVENT_TRAILBLAZERS_2026",
				displayName: "Trailblazers Promo Launch",
				description: "Official promotional campaign celebrating in-form players with modified PlayStyles",
				stagedAt: "2026-09-17T08:00:00Z",
				source: "LOC_DIFF",
			},
			{
				type: "PACK",
				identifier: "p10482_85x10_promo",
				displayName: "85+ x10 Players Pack",
				description: "Guaranteed 10 rare gold players rated 85 or higher with untradeable status",
				stagedAt: "2026-09-17T07:45:00Z",
				source: "PACK_CODE",
				metadata: { minRating: 85, count: 10, untradeable: true },
			},
		];
	}

	/**
	 * Inspects an ETag or hash header for changes against a known cache.
	 */
	public checkEtagChange(targetUrl: string, currentEtag?: string): boolean {
		if (!currentEtag) return false;
		const previous = this.knownEtags.get(targetUrl);
		if (!previous) {
			this.knownEtags.set(targetUrl, currentEtag);
			return false;
		}
		if (previous !== currentEtag) {
			this.knownEtags.set(targetUrl, currentEtag);
			return true;
		}
		return false;
	}

	/**
	 * Analyzes a raw localization JSON dictionary and extracts newly registered promo keys.
	 */
	public diffLocalizationStrings(rawLocJson: Record<string, string>): LeakedEntity[] {
		const newEntities: LeakedEntity[] = [];
		const now = new Date().toISOString();

		for (const [key, value] of Object.entries(rawLocJson)) {
			if (this.knownLocKeys.has(key)) continue;
			this.knownLocKeys.add(key);

			const upperKey = key.toUpperCase();
			if (upperKey.startsWith("EVENT_") || upperKey.includes("PROMO_")) {
				newEntities.push({
					type: "PROMO",
					identifier: key,
					displayName: value,
					stagedAt: now,
					source: "LOC_DIFF",
				});
			} else if (upperKey.startsWith("SBC_") || upperKey.includes("CHALLENGE_NAME_")) {
				newEntities.push({
					type: "SBC",
					identifier: key,
					displayName: value,
					stagedAt: now,
					source: "LOC_DIFF",
				});
			} else if (upperKey.startsWith("EVO_") || upperKey.includes("EVOLUTION_")) {
				newEntities.push({
					type: "EVOLUTION",
					identifier: key,
					displayName: value,
					stagedAt: now,
					source: "LOC_DIFF",
				});
			} else if (upperKey.startsWith("PACK_") || upperKey.includes("STORE_PACK_")) {
				newEntities.push({
					type: "PACK",
					identifier: key,
					displayName: value,
					stagedAt: now,
					source: "LOC_DIFF",
				});
			}
		}

		this.stagedLeaksStore.push(...newEntities);
		return newEntities;
	}

	/**
	 * Queries currently known staged leaks with optional filtering.
	 */
	public queryLeaks(filter: {
		type?: LeakedEntity["type"];
		query?: string;
		minRating?: number;
	} = {}): LeakedEntity[] {
		return this.stagedLeaksStore.filter((item) => {
			if (filter.type && item.type !== filter.type) return false;
			if (filter.query) {
				const q = filter.query.toLowerCase();
				const matchName = item.displayName.toLowerCase().includes(q);
				const matchId = item.identifier.toLowerCase().includes(q);
				if (!matchName && !matchId) return false;
			}
			if (filter.minRating && item.metadata && typeof item.metadata.rating === "number") {
				if (item.metadata.rating < filter.minRating) return false;
			}
			return true;
		});
	}
}
