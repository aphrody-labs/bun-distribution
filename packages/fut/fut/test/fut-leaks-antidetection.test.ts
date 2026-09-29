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

import { describe, expect, it } from "bun:test";
import {
	detectUtasSoftBan,
	EaStagingPoller,
	generateGaussianJitter,
	getAlternatingMinBid,
	simulateHumanClick,
} from "../src/index.ts";

describe("EA Staging Leaks Engine & Paletools-Grade Anti-Detection", () => {
	describe("EaStagingPoller (Staging, ETags, Loc Diffs & Pack Codes)", () => {
		it("detects ETag changes over monitored CDN asset endpoints", () => {
			const poller = new EaStagingPoller();
			const url = "https://fifa21.content.easports.com/fifa/fltOnlineAssets/b1/2025/fut/items/web/players.json";

			// First check: registers baseline ETag
			expect(poller.checkEtagChange(url, '"etag-v1-abc"')).toBe(false);

			// Same ETag: no change
			expect(poller.checkEtagChange(url, '"etag-v1-abc"')).toBe(false);

			// Modified ETag: change detected!
			expect(poller.checkEtagChange(url, '"etag-v2-def"')).toBe(true);
		});

		it("diffs localization strings to discover unannounced promos, SBCs, and evolutions", () => {
			const poller = new EaStagingPoller();
			const incomingLoc = {
				EVENT_BLACK_FRIDAY_2026: "Thunderstruck Promo",
				SBC_FLASHBACK_BENZEMA: "Flashback Karim Benzema",
				EVO_POWER_SURGE_2: "Power Surge II Evolution",
				PACK_ULTIMATE_TOTY_RESERVE: "Ultimate TOTY Reserve Pack",
				GENERIC_UI_BUTTON: "Confirm and Continue",
			};

			const newLeaks = poller.diffLocalizationStrings(incomingLoc);
			expect(newLeaks.length).toBe(4);

			const types = newLeaks.map((l) => l.type);
			expect(types).toContain("PROMO");
			expect(types).toContain("SBC");
			expect(types).toContain("EVOLUTION");
			expect(types).toContain("PACK");

			// Query the stored leaks
			const sbcQuery = poller.queryLeaks({ query: "Benzema" });
			expect(sbcQuery.length).toBe(1);
			expect(sbcQuery[0].displayName).toBe("Flashback Karim Benzema");
		});

		it("filters staged leaks by minimum overall rating", () => {
			const poller = new EaStagingPoller();
			const leaksHigh = poller.queryLeaks({ minRating: 92 });
			expect(leaksHigh.length).toBeGreaterThanOrEqual(1);
			expect(leaksHigh[0].displayName).toContain("Mbappé");
		});
	});

	describe("AntiDetectionThrottler & Humanized Automation", () => {
		it("generates Gaussian-distributed jitter within safe bounds", () => {
			for (let i = 0; i < 20; i++) {
				const delay = generateGaussianJitter(1500, 350, 800, 3500);
				expect(delay).toBeGreaterThanOrEqual(800);
				expect(delay).toBeLessThanOrEqual(3500);
			}
		});

		it("alternates search min bid to bust EA edge cache", () => {
			expect(getAlternatingMinBid(150)).toBe(200);
			expect(getAlternatingMinBid(200)).toBe(150);
		});

		it("detects UTAS HTTP 429 and FunCaptcha soft-bans with cooldowns", () => {
			const res429 = detectUtasSoftBan(429);
			expect(res429.isSoftBan).toBe(true);
			expect(res429.isCaptcha).toBe(false);
			expect(res429.cooldownSeconds).toBe(900);

			const resCaptcha = detectUtasSoftBan(200, { code: 458 });
			expect(resCaptcha.isSoftBan).toBe(true);
			expect(resCaptcha.isCaptcha).toBe(true);
			expect(resCaptcha.cooldownSeconds).toBe(3600);

			const resOk = detectUtasSoftBan(200, { items: [] });
			expect(resOk.isSoftBan).toBe(false);
			expect(resOk.isCaptcha).toBe(false);
			expect(resOk.cooldownSeconds).toBe(0);
		});

		it("synthesizes human clicks with bounding rect offsets", async () => {
			let clicks = 0;
			const mockElement = {
				getBoundingClientRect: () => ({ left: 50, top: 50, width: 120, height: 40 }),
				dispatchEvent: () => {
					clicks++;
					return true;
				},
			};

			const success = await simulateHumanClick(mockElement as any);
			expect(success).toBe(true);
			expect(clicks).toBeGreaterThanOrEqual(1);
		});
	});
});
