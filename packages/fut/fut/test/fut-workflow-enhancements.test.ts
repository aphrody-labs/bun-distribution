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
import { hasFutDataset } from "./helpers/fut-dataset.ts";
import { extractTsrPlayer } from "../src/futgg.ts";
import { extractFutbinPlayer } from "../src/futbin.ts";
import { detectMarketAnomaly } from "../src/prediction/anomalyDetector.ts";
import { FutPricePredictor, predictPlayerDualPlatform } from "../src/prediction/index.ts";
import { FutDatabaseRepository } from "../src/repository/FutDatabaseRepository.ts";
import type { DetailedCardStats } from "../src/squad/metaRating.ts";
import type { PlayerPricePrediction } from "../src/prediction/types.ts";

describe("FUT Workflow & Real-World Trading Enhancements", () => {
	describe("FUTBin HTML Parser (extractFutbinPlayer)", () => {
		it("extracts player attributes, rating, and prices from FUTBIN page markup", () => {
			const mockHtml = `
				<!DOCTYPE html>
				<html>
				<head>
					<title>João Pedro Gonçalves Neves FC 27 - 88 - Rating and Price | FUTBIN</title>
				</head>
				<body>
					<div class="player-name">João Pedro Gonçalves Neves</div>
					<div class="pcdisplay-rat">88</div>
					<div class="pcdisplay-pos">CM</div>
					<div class="pcdisplay-pac">78</div>
					<div class="pcdisplay-sho">75</div>
					<div class="pcdisplay-pas">85</div>
					<div class="pcdisplay-dri">88</div>
					<div class="pcdisplay-def">86</div>
					<div class="pcdisplay-phy">84</div>
					<div class="playstyle" data-name="Press Proven+"></div>
					<div class="playstyle" data-name="Tiki Taka"></div>
					<div class="skills">3★ Skills</div>
					<div class="weak-foot">4★ Weak Foot</div>
					<div class="price-box ps" data-price-console="17000"></div>
					<div class="price-box pc" data-price-pc="21000"></div>
				</body>
				</html>
			`;

			const player = extractFutbinPlayer(mockHtml);
			expect(player).not.toBeNull();
			if (!player) return;

			expect(player.name).toBe("João Pedro Gonçalves Neves");
			expect(player.overallRating).toBe(88);
			expect(player.position).toBe("CM");
			expect(player.pac).toBe(78);
			expect(player.def).toBe(86);
			expect(player.playstylesPlus).toContain("Press Proven+");
			expect(player.playstyles).toContain("Tiki Taka");
			expect(player.price).toBe("17000");
			expect(player.skillMoves).toBe(3);
			expect(player.weakFoot).toBe(4);
		});
	});
	describe("TSR Hydration Parser (extractTsrPlayer)", () => {
		it("extracts full player attributes, PlayStyles+, and Roles++ from TanStack stream barrier", () => {
			const mockHtml = `
				<!DOCTYPE html>
				<html>
				<head><title>João Neves FC 27 - FUT.GG</title></head>
				<body>
					<script class="$tsr" id="$tsr-stream-barrier">
						nickname:"João Neves",firstName:"João Pedro",lastName:"Gonçalves Neves",
						overall:88,position:14,alternativePositionIds:$R[0]=[10],
						playstyles:[8,23],playstylesPlus:[21],
						rolesPlus:[16],rolesPlusPlus:[118],
						uniqueClubSlug:"73-paris-saint-germain",
						facePace:78,faceShooting:75,facePassing:85,faceDribbling:88,faceDefending:86,facePhysicality:84,
						attributeAcceleration:80,attributeSprintSpeed:76,
						attributeAgility:89,attributeBalance:92,attributeReactions:91,
						attributeBallControl:90,attributeDribbling:88,attributeComposure:92,
						attributeInterceptions:88,attributeDefensiveAwareness:87,attributeStandingTackle:86,attributeSlidingTackle:82,
						attributeStamina:94,attributeStrength:80,attributeAggression:87,
						skillMoves:3,weakFoot:4,foot:1,height:174,weight:66,accelerateType:"Controlled"
					</script>
				</body>
				</html>
			`;

			const player = extractTsrPlayer(mockHtml);
			expect(player).not.toBeNull();
			if (!player) return;

			expect(player.name).toBe("João Neves");
			expect(player.overallRating).toBe(88);
			expect(player.position).toBe("CM");
			expect(player.alternativePositions).toContain("CDM");
			expect(player.club).toBe("PARIS SAINT GERMAIN");

			// PlayStyles & PlayStyles+
			expect(player.playstyles).toContain("Tiki Taka");
			expect(player.playstyles).toContain("Relentless");
			expect(player.playstylesPlus).toContain("Press Proven+");

			// In-game stats
			expect(player.pac).toBe(78);
			expect(player.composure).toBe(92);
			expect(player.reactions).toBe(91);
			expect(player.stamina).toBe(94);
			expect(player.weakFoot).toBe(4);
			expect(player.foot).toBe("Right");
		});

		it("returns null gracefully when TSR stream barrier is absent", () => {
			const emptyHtml = "<html><body><div>Just a normal page</div></body></html>";
			expect(extractTsrPlayer(emptyHtml)).toBeNull();
		});
	});

	describe("Market Anomaly & Credit Freeze Detection", () => {
		it("detects Day 1 early Web App credit shortage and triggers HOLD_ABSOLUTE alert", () => {
			const joaoNevesCard: DetailedCardStats = {
				id: "joao_neves_88",
				name: "João Neves",
				overallRating: 88,
				position: "CM",
				pac: 78,
				sho: 75,
				pas: 85,
				dri: 88,
				def: 86,
				phy: 84,
				composure: 92,
				reactions: 91,
				weakFoot: 4,
				skillMoves: 3,
				playstylesPlus: ["Press Proven+"],
			};

			// João Neves priced at only 17,000 on Console during pre-launch
			const preLaunchDate = new Date(2026, 8, 18); // September 18, 2026
			const dual = predictPlayerDualPlatform(joaoNevesCard, {
				livePriceConsole: 17000,
				livePricePc: 22000,
				referenceDate: preLaunchDate,
			});

			const anomaly = dual.anomalyReport;
			expect(anomaly).toBeDefined();
			if (!anomaly) return;

			expect(anomaly.hasAnomaly).toBe(true);
			// 17,000 is lower than 88 fodder floor (21,000)
			expect(anomaly.anomalyType).toBe("BELOW_FODDER_FLOOR");
			expect(anomaly.advisoryAction).toBe("HOLD_ABSOLUTE");
			expect(anomaly.urgency).toBe("CRITICAL");
			expect(anomaly.isBelowFodderFloor).toBe(true);
			expect(anomaly.fodderFloor).toBe(21000);

			// Recovery milestones
			expect(anomaly.recoveryMilestones.length).toBe(4);
			const firstWeekend = anomaly.recoveryMilestones[1];
			expect(firstWeekend.projectedPrice).toBeGreaterThan(17000);
			expect(firstWeekend.expectedProfitPerCard).toBeGreaterThan(0);
		});

		it("detects overpriced hype bubble and recommends SELL_URGENT", () => {
			const mockPrediction: PlayerPricePrediction = {
				playerId: "hyped_player",
				playerName: "Hyped New Card",
				overallRating: 83,
				position: "ST",
				platform: "console",
				factualMetaRating: 75,
				metaTier: "B",
				currentLivePrice: 150000,
				fairValuePrice: 35000, // 76% overpriced
				priceVsFairValuePercent: 328.6,
				currentMarketPhase: "LAUNCH_WEEK",
				dayOfWeek: "FRIDAY",
				signal: "PANIC_SELL",
				targetBuyPrice: 30000,
				targetSellPrice: 150000,
				stopLossPrice: 120000,
				riskLevel: "HIGH",
				catalysts: [],
				risks: [],
				forecasts: {
					"12h": { horizon: "12h", targetTimestamp: Date.now() + 43200000, predictedPrice: 140000, trend: "DOWN", confidenceInterval: [130000, 150000], projectedProfitPerCard: -17000, expectedNetRoiPercent: -11 },
					"24h": { horizon: "24h", targetTimestamp: Date.now() + 86400000, predictedPrice: 120000, trend: "CRASH", confidenceInterval: [110000, 130000], projectedProfitPerCard: -36000, expectedNetRoiPercent: -24 },
					"3d": { horizon: "3d", targetTimestamp: Date.now() + 259200000, predictedPrice: 90000, trend: "CRASH", confidenceInterval: [80000, 100000], projectedProfitPerCard: -64500, expectedNetRoiPercent: -43 },
					"7d": { horizon: "7d", targetTimestamp: Date.now() + 604800000, predictedPrice: 50000, trend: "CRASH", confidenceInterval: [45000, 60000], projectedProfitPerCard: -102500, expectedNetRoiPercent: -68 },
					"14d": { horizon: "14d", targetTimestamp: Date.now() + 1209600000, predictedPrice: 38000, trend: "CRASH", confidenceInterval: [32000, 45000], projectedProfitPerCard: -113900, expectedNetRoiPercent: -76 },
				},
				factors: {
					platform: "console",
					metaPremiumPercent: 10,
					fc26SeasonalTrendPercent: 0,
					intraWeekCycleMultiplier: 1.05,
					fodderAnchorRatio: 0,
					evoHypeBonusPercent: 0,
					marketLiquidityScore: 80,
				},
				fc26HistoricalComparison: {
					equivalentPlayerName: "Hyped Player FC 26",
					fc26PriceAtSameDay: 140000,
					fc26Price7DaysLater: 55000,
					fc26ObservedTrendPercent: -60,
				},
			};

			const report = detectMarketAnomaly(mockPrediction);
			expect(report.hasAnomaly).toBe(true);
			expect(report.anomalyType).toBe("OVERPRICED_HYPE");
			expect(report.advisoryAction).toBe("SELL_URGENT");
			expect(report.urgency).toBe("HIGH");
		});
	});

	describe("Multi-Diacritic SQLite Search & Upsert", () => {
		it.skipIf(!hasFutDataset)("normalizes Portuguese, Spanish, and French accents for seamless lookup", () => {
			const repo = new FutDatabaseRepository();

			// Upsert test card with Portuguese diacritics
			repo.upsertPlayer({
				id: "test_joao_neves_psg",
				name: "João Pedro Gonçalves Neves",
				overallRating: 88,
				position: "CM",
				club: "Paris Saint-Germain",
				nation: "Portugal",
				league: "Ligue 1",
				pac: 78,
				sho: 75,
				pas: 85,
				dri: 88,
				def: 86,
				phy: 84,
			});

			// Search with plain ASCII "Joao Neves"
			const resultsAscii = repo.queryPlayers({ name: "Joao Neves" });
			expect(resultsAscii.length).toBeGreaterThan(0);
			expect(resultsAscii.some((p) => p.name.includes("João"))).toBe(true);

			// Search with "Goncalves" without cedilla
			const resultsGoncalves = repo.queryPlayers({ name: "Goncalves" });
			expect(resultsGoncalves.length).toBeGreaterThan(0);

			repo.close();
		});
	});

	describe("FutPricePredictor Dual-Platform Integration", () => {
		it.skipIf(!hasFutDataset)("runs end-to-end dual platform prediction with market anomaly report", async () => {
			const predictor = new FutPricePredictor();

			// Predict with live console price 17,000 for Joao Neves
			const dual = await predictor.predictPlayerDual("Joao Neves", {
				livePriceConsole: 17000,
				livePricePc: 21000,
				referenceDate: new Date(2026, 8, 18),
			});

			expect(dual).not.toBeNull();
			if (!dual) return;

			expect(dual.overallRating).toBe(88);
			expect(dual.console.platform).toBe("console");
			expect(dual.pc.platform).toBe("pc");

			// Anomaly report presence
			expect(dual.anomalyReport).toBeDefined();
			expect(dual.anomalyReport?.hasAnomaly).toBe(true);
			expect(dual.anomalyReport?.advisoryAction).toBe("HOLD_ABSOLUTE");

			predictor.close();
		});
	});
});
