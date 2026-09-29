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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	CARD_SHELL_SPECS,
	CardShellManager,
	ControllerGlyphsFormatter,
	FC27_DESIGN_TOKENS,
	Fc27ComponentRenderer,
	MarketFilterMatrix,
	TacticalRadarRenderer,
	type CardShellId,
} from "../src/index.ts";

describe("Frostbite UI Assets, Market Filters Matrix & Design System", () => {
	describe("Frostbite Asset Manifest & Screenshots Verification", () => {
		it("validates frostbite_asset_manifest.json containing the 8 decoded assets", () => {
			const manifestPath = join(import.meta.dir, "../src/data/frostbite_asset_manifest.json");
			const content = JSON.parse(readFileSync(manifestPath, "utf-8"));

			expect(content.totalAssets).toBe(8);
			expect(content.engine).toContain("Frostbite");
			expect(Array.isArray(content.assets)).toBe(true);
			expect(content.assets.length).toBe(8);

			const filenames = content.assets.map((a: any) => a.filename);
			expect(filenames).toContain("tx_ui_ut_packopen_contents_modal.png");
			expect(filenames).toContain("tx_ui_ut_squad_pitch_tactics_overview.png");
			expect(filenames).toContain("tx_ui_ut_squad_hud_stadium_bench_cards.png");
			expect(filenames).toContain("tx_ui_ut_fciq_tactics_collective_radar.png");
			expect(filenames).toContain("tx_ui_ut_fciq_roles_player_focus_inspect.png");
			expect(filenames).toContain("tx_ui_ut_transfermarket_search_filters_grid.png");
			expect(filenames).toContain("tx_ui_ut_hub_main_accueil_dashboard.png");
			expect(filenames).toContain("tx_ui_ut_objectives_reward_cornerstone_savio.png");
		});

		it("confirms EBX partition namespaces follow official Frostbite patterns", () => {
			const manifestPath = join(import.meta.dir, "../src/data/frostbite_asset_manifest.json");
			const content = JSON.parse(readFileSync(manifestPath, "utf-8"));

			for (const asset of content.assets) {
				expect(asset.ebxPartition).toStartWith("content/futfoundation/");
				expect(asset.screenLayoutId).toStartWith("Screen_UT_");
			}
		});
	});

	describe("Transfer Market 9-Tile Filter Matrix", () => {
		it("generates the exact 9 filter tiles as seen in-game", () => {
			const matrix = new MarketFilterMatrix({
				name: "Sávio",
				rarity: "cornerstones",
				position: "RW",
			});

			const tiles = matrix.generateGridTiles();
			expect(tiles.length).toBe(9);

			const ids = tiles.map((t) => t.id);
			expect(ids).toEqual([
				"name",
				"rarity",
				"position",
				"playstyles",
				"chemistry_style",
				"pricing",
				"nation",
				"league",
				"club",
			]);

			expect(tiles[0].currentDisplayValue).toBe("Sávio");
			expect(tiles[1].currentDisplayValue).toBe("CORNERSTONES");
			expect(tiles[2].currentDisplayValue).toBe("RW");
		});

		it("rounds price inputs according to official EA coin step intervals", () => {
			// <= 1000: step 50
			expect(MarketFilterMatrix.roundToValidPriceStep(430)).toBe(450);
			expect(MarketFilterMatrix.roundToValidPriceStep(420)).toBe(400);

			// 1000 - 10000: step 100
			expect(MarketFilterMatrix.roundToValidPriceStep(3240)).toBe(3200);
			expect(MarketFilterMatrix.roundToValidPriceStep(3260)).toBe(3300);

			// 10000 - 50000: step 250
			expect(MarketFilterMatrix.roundToValidPriceStep(15120)).toBe(15000);
			expect(MarketFilterMatrix.roundToValidPriceStep(15180)).toBe(15250);

			// 50000 - 100000: step 500
			expect(MarketFilterMatrix.roundToValidPriceStep(75220)).toBe(75000);
			expect(MarketFilterMatrix.roundToValidPriceStep(75350)).toBe(75500);

			// > 100000: step 1000
			expect(MarketFilterMatrix.roundToValidPriceStep(146606)).toBe(147000);
		});

		it("compiles high-level filter matrix into native UTAS market search parameters", () => {
			const matrix = new MarketFilterMatrix({
				rarity: "gold_rare",
				position: "ST",
				pricing: {
					minBuyNow: 1200,
					maxBuyNow: 45000,
				},
				nationId: 54, // France
				leagueId: 13, // Premier League
				page: 2,
				pageSize: 25,
			});

			const params = matrix.toUtasParams();
			expect(params.type).toBe("player");
			expect(params.lev).toBe("gold");
			expect(params.pos).toBe("ST");
			expect(params.minb).toBe(1200);
			expect(params.maxb).toBe(45000);
			expect(params.nat).toBe(54);
			expect(params.leag).toBe(13);
			expect(params.start).toBe(25);
			expect(params.num).toBe(25);
		});

		it("instantiates pre-configured tactical sniping presets", () => {
			const cornerstonePreset = MarketFilterMatrix.createPreset("cornerstones");
			const params = cornerstonePreset.toUtasParams();
			expect(params.lev).toBe("special");
			expect(params.maxb).toBe(15000);

			const shadowPreset = MarketFilterMatrix.createPreset("shadow_defenders");
			expect(shadowPreset.getQuery().chemStyle).toBe("shadow");
			expect(shadowPreset.getQuery().position).toBe("defenders");
		});
	});

	describe("FC 27 Design System Tokens & Components", () => {
		it("exposes consistent brand colors, surfaces, and typography tokens", () => {
			expect(FC27_DESIGN_TOKENS.colors.brand.neonGreen).toBe("#00FF85");
			expect(FC27_DESIGN_TOKENS.colors.surfaces.glassBase).toContain("rgba(11, 16, 22");
			expect(FC27_DESIGN_TOKENS.typography.weights.bold).toBe(700);
		});

		it("provides complete visual specs for all decoded card shells", () => {
			const shells: CardShellId[] = [
				"gold_rare",
				"gold_common",
				"icon_hero_white_gold",
				"special_totw_ucl_black",
				"evolution_emerald_green",
				"cornerstone_pierre_angulaire",
				"electric_blue_crystal",
			];

			for (const shell of shells) {
				const spec = CARD_SHELL_SPECS[shell];
				expect(spec).toBeDefined();
				expect(spec.backgroundGradient).toContain("gradient");
				expect(spec.textColor).toBeDefined();
			}
		});

		it("renders FC IQ Role Badges with tier-specific colors and formatting", () => {
			const badgePlus = CardShellManager.renderRoleBadge("Attaquante avancée", "+");
			expect(badgePlus).toContain("#10B981");
			expect(badgePlus).toContain("Attaquante avancée");

			const badgePlusPlus = CardShellManager.renderRoleBadge("Milieu défensif ++", "++");
			expect(badgePlusPlus).toContain("#00FF85");
			expect(badgePlusPlus).toContain("++");
		});

		it("renders responsive 6-axis SVG tactical radar polygon", () => {
			const svg = TacticalRadarRenderer.renderSvg({
				ATT: 85,
				DEF: 78,
				LAR: 70,
				END: 92,
				PRO: 65,
				CST: 80,
			}, { size: 240, showLabels: true });

			expect(svg).toStartWith("<svg");
			expect(svg).toContain("polygon");
			expect(svg).toContain("#00FF85");
			expect(svg).toContain("ATT");
			expect(svg).toContain("DEF");
			expect(svg).toContain("LAR");
			expect(svg).toContain("END");
			expect(svg).toContain("PRO");
			expect(svg).toContain("CST");
		});

		it("renders controller HUD prompts and action bar", () => {
			const prompt = ControllerGlyphsFormatter.renderPrompt("A", "Choisir");
			expect(prompt).toContain("Choisir");
			expect(prompt).toContain(">A<");

			const actionBar = ControllerGlyphsFormatter.renderActionBar([
				{ button: "A", label: "Choisir" },
				{ button: "B", label: "Retour" },
				{ button: "Y", label: "Recherche" },
			]);
			expect(actionBar).toContain("Choisir");
			expect(actionBar).toContain("Retour");
			expect(actionBar).toContain("Recherche");
		});

		it("renders player card, 9-tile filter grid, and tactics card components cleanly", () => {
			// Player Card
			const cardHtml = Fc27ComponentRenderer.renderPlayerCard({
				name: "Sávio",
				rating: 83,
				position: "AD",
				shellId: "cornerstone_pierre_angulaire",
				club: "Tottenham Hotspur",
				nation: "Brésil",
				stats: { PAC: 90, SHO: 76, PAS: 79, DRI: 87, DEF: 37, PHY: 56 },
				roleBadge: "Ailier ++",
				playStylePlus: "Rapide",
			});
			expect(cardHtml).toContain("Sávio");
			expect(cardHtml).toContain("83");
			expect(cardHtml).toContain("AD");
			expect(cardHtml).toContain("RAP");
			expect(cardHtml).toContain("Tottenham Hotspur");

			// 9-tile Grid
			const matrix = new MarketFilterMatrix({ name: "Mbappé" });
			const gridHtml = Fc27ComponentRenderer.renderMarketFilterGrid(matrix);
			expect(gridHtml).toContain("fc-market-filter-grid");
			expect(gridHtml).toContain("Nom");
			expect(gridHtml).toContain("Mbappé");

			// Tactics Card
			const tacticsHtml = Fc27ComponentRenderer.renderTacticsCard({
				shareCode: "WBwkfGuhCSMX",
				formation: "4-4-2 CONSERVA",
				buildUpStyle: "ÉQUILIBRÉ",
				defensiveApproach: "HAUTE",
				pros: ["Menace sur l'aile", "Un cardio d'enfer"],
				risks: ["Manque d'options offensives"],
				metrics: { ATT: 85, DEF: 78, LAR: 70, END: 92, PRO: 65, CST: 80 },
			});
			expect(tacticsHtml).toContain("WBwkfGuhCSMX");
			expect(tacticsHtml).toContain("4-4-2 CONSERVA");
			expect(tacticsHtml).toContain("Menace sur l'aile");
		});
	});
});

describe("Frostbite asset manifest module", () => {
	it("reads the manifest through the package rather than a hard-coded path", async () => {
		const { listFrostbiteAssets, FROSTBITE_ASSET_MANIFEST } = await import(
			"../src/design-system/assetManifest.ts"
		);
		expect(listFrostbiteAssets()).toHaveLength(FROSTBITE_ASSET_MANIFEST.totalAssets);
		expect(FROSTBITE_ASSET_MANIFEST.engine).toBeTruthy();
	});

	it("looks an asset up by code name or file name, case-insensitively", async () => {
		const { getFrostbiteAsset } = await import(
			"../src/design-system/assetManifest.ts"
		);
		const byCode = getFrostbiteAsset("tx_ui_ut_transfermarket_search_filters_grid");
		expect(byCode?.category).toBe("TRANSFER_MARKET_FILTERS");
		expect(getFrostbiteAsset("TX_UI_UT_TRANSFERMARKET_SEARCH_FILTERS_GRID.png")?.filename).toBe(
			byCode?.filename,
		);
		expect(getFrostbiteAsset("does-not-exist")).toBeUndefined();
	});

	it("groups assets by category with counts that sum to the total", async () => {
		const { frostbiteAssetCategories, listFrostbiteAssets, getFrostbiteAssetsByCategory } =
			await import("../src/design-system/assetManifest.ts");
		const cats = frostbiteAssetCategories();
		expect(cats.reduce((n, c) => n + c.count, 0)).toBe(listFrostbiteAssets().length);
		expect(getFrostbiteAssetsByCategory("pack_opening")).toHaveLength(1);
		expect(getFrostbiteAssetsByCategory("nope")).toHaveLength(0);
	});
});
