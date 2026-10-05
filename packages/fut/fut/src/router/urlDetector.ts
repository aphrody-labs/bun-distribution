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

import type { DetectedUrlInfo, FutPageType, FutProvider } from "./types.ts";

/**
 * Classifies and parses any EA SPORTS FC / FIFA Ultimate Team URL from FUTBin, FUT.GG or EA.
 */
export function detectFutUrlType(rawUrl: string): DetectedUrlInfo {
	let provider: FutProvider = "UNKNOWN";
	let pageType: FutPageType = "UNKNOWN";
	let gameYear = "27";
	let identifier: string | undefined;
	let slug: string | undefined;
	const queryParams: Record<string, string> = {};

	let urlObj: URL;
	try {
		urlObj = new URL(rawUrl);
	} catch {
		return {
			rawUrl,
			provider: "UNKNOWN",
			pageType: "UNKNOWN",
			gameYear: "27",
			queryParams: {},
		};
	}

	const host = urlObj.hostname.toLowerCase();
	const path = urlObj.pathname.toLowerCase();

	// Extract query params
	for (const [key, val] of urlObj.searchParams.entries()) {
		queryParams[key] = val;
	}

	// 1. Detect Provider
	if (host.includes("futbin.com")) {
		provider = "FUTBIN";
	} else if (host.includes("fut.gg")) {
		provider = "FUTGG";
	} else if (host.includes("ea.com") || host.includes("ea-sports-fc")) {
		provider = "EA";
	}

	// 2. Extract Game Year if present (e.g. /24/, /25/, /26/, /27/)
	const yearMatch = path.match(/\/(2[4-7])\//);
	if (yearMatch) {
		gameYear = yearMatch[1];
	}

	// 3. Classify Page Type

	// A. Player Detail Page
	// FUT.GG: /players/272834-joao-neves/27-272834/
	// FUTBin: /27/player/97/joao-pedro-goncalves-neves
	if (
		(provider === "FUTGG" && path.includes("/players/") && path.match(/\/players\/[0-9]+-[^/]+/)) ||
		(provider === "FUTBIN" && path.includes("/player/"))
	) {
		pageType = "PLAYER";
		if (provider === "FUTGG") {
			const m = path.match(/\/players\/([0-9]+)-([^/]+)/);
			if (m) {
				identifier = m[1];
				slug = m[2];
			}
		} else {
			const m = path.match(/\/player\/([0-9]+)(?:\/([^/]+))?/);
			if (m) {
				identifier = m[1];
				slug = m[2];
			}
		}
		return { rawUrl, provider, pageType, gameYear, identifier, slug, queryParams };
	}

	// B. SBC Page
	// FUT.GG: /sbc/, /sbc/icon-upgrade/, /sbc/challenge/123/
	// FUTBin: /squad-building-challenges, /squad-building-challenges/EA/512
	if (path.includes("/sbc") || path.includes("/squad-building-challenges")) {
		pageType = "SBC";
		// fut.gg nests sets under a category: /sbc/upgrades/27-6-gold-upgrade/.
		// Take the LAST path segment, not the first, or the category is mistaken
		// for the set and the detail fetch 404s. The year prefix is dropped
		// because FutSbcClient.getSetDetail() passes gameYear separately.
		const sbcSegments = (path.match(/\/sbc\/(.+)$/i)?.[1] ?? "")
			.split("/")
			.filter(Boolean);
		const sbcSlug = sbcSegments.at(-1)?.replace(/^[0-9]{2}-/, "");
		const mFutBin = path.match(/\/squad-building-challenges\/(?:ea\/)?([0-9]+|[a-z0-9-]+)/i);
		if (sbcSlug && sbcSlug !== "challenge" && !/^[0-9]+$/.test(sbcSlug)) {
			slug = sbcSlug;
		} else if (mFutBin) {
			identifier = mFutBin[1];
		}
		return { rawUrl, provider, pageType, gameYear, identifier, slug, queryParams };
	}

	// C. Squad Builder Page
	// FUT.GG: /squad-builder/, /squad-builder/12345/, /squads/12345/
	// FUTBin: /squad/, /squad/12345, /community/squad/12345
	if (path.includes("/squad-builder") || path.includes("/squad/") || path.includes("/squads/")) {
		pageType = "SQUAD";
		const m = path.match(/\/(?:squad-builder|squads|squad)\/([0-9a-z-]+)/);
		if (m) {
			identifier = m[1];
		}
		return { rawUrl, provider, pageType, gameYear, identifier, queryParams };
	}

	// D. Evolution Page
	// FUT.GG: /evolutions/, /evolutions/27-relentless-winger/
	// FUTBin: /evolutions, /evolutions/123/winger
	if (path.includes("/evolutions") || path.includes("/evolution")) {
		pageType = "EVOLUTION";
		// Keep the year prefix here: FutEvolutionsClient.getEvolutionDetail()
		// builds /evolutions/<slug>/ directly, and its listing regex expects the
		// `27-relentless-winger` form.
		const m = path.match(/\/evolutions?\/([a-z0-9-]+)(?:\/|$)/);
		const evoSlug = m?.[1];
		if (evoSlug && evoSlug !== "all" && evoSlug !== "active") {
			slug = evoSlug;
		}
		return { rawUrl, provider, pageType, gameYear, slug, queryParams };
	}

	// E. Fodder Index / Market Page
	// FUTBin: /market/, /market/fodder, /fodder
	// FUT.GG: /fodder/, /prices/
	if (path.includes("/fodder") || path === "/market" || path === "/market/" || path.includes("/prices")) {
		pageType = "FODDER";
		return { rawUrl, provider, pageType, gameYear, queryParams };
	}

	// F. Players Listing / Market Filter Page
	// FUT.GG: /players/, /players/?positions=...
	// FUTBin: /players, /27/players?page=...
	if (path.includes("/players") || path.includes("/all-players")) {
		pageType = "MARKET_LISTING";
		return { rawUrl, provider, pageType, gameYear, queryParams };
	}

	return {
		rawUrl,
		provider,
		pageType,
		gameYear,
		identifier,
		slug,
		queryParams,
	};
}
