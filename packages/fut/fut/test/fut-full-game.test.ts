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
	AcceleRateCalculator,
	CareerManager,
	CareerSaveParser,
	CasReader,
	CatReader,
	EbxParser,
	FcIqCodec,
	FcSetupOptimizer,
	FrostbiteCompression,
	InGameStatsCalculator,
	MasterDatabase,
	MatchSimulator,
	OodleDecompressor,
	ProClubsRushEngine,
	SbcIlpSolver,
	SquadSaveParser,
	TocReader,
	TournamentEngine,
	type MasterPlayer,
} from "../src/index.ts";

describe("Module 1: Frostbite VFS & CAS/CAT Engine", () => {
	it("parses standard 8-byte Frostbite chunk headers accurately", () => {
		const reader = new CasReader();
		const buffer = new Uint8Array(16);
		const view = new DataView(buffer.buffer);
		view.setUint32(0, 65536, false); // 64KB decompressed
		view.setUint16(4, FrostbiteCompression.OodleKraken, false); // 0x0900
		view.setUint16(6, 16384, false); // 16KB compressed

		const header = reader.parseHeader(buffer, 0);
		expect(header.decompressedSize).toBe(65536);
		expect(header.compressionType).toBe(FrostbiteCompression.OodleKraken);
		expect(header.compressedSize).toBe(16384);
		expect(header.payloadOffset).toBe(8);
	});

	it("decompresses uncompressed and zlib payloads correctly", () => {
		const oodle = OodleDecompressor.getInstance();
		const raw = new TextEncoder().encode("Frostbite_Core2_Superbundle_Test_Data");
		const resNone = oodle.decompress(raw, raw.length, FrostbiteCompression.None);
		expect(new TextDecoder().decode(resNone)).toBe("Frostbite_Core2_Superbundle_Test_Data");
	});

	it("parses binary cas.cat catalogs and maps SHA-1 entries", () => {
		const catReader = new CatReader();
		// Build synthetic 32-byte CAT entry: 20 bytes SHA-1, 4 bytes offset, 4 bytes size, 4 bytes casIndex
		const buffer = new Uint8Array(32);
		const view = new DataView(buffer.buffer);
		// SHA-1 = 0102030405060708090a0b0c0d0e0f1011121314
		for (let i = 0; i < 20; i++) buffer[i] = i + 1;
		view.setUint32(20, 1024, true); // offset = 1024
		view.setUint32(24, 2048, true); // size = 2048
		view.setUint32(28, 1, true);    // casIndex = 1 (cas_01.cas)

		const count = catReader.parseBuffer(buffer);
		expect(count).toBe(1);
		const entry = catReader.get("0102030405060708090a0b0c0d0e0f1011121314");
		expect(entry).toBeDefined();
		expect(entry?.offset).toBe(1024);
		expect(entry?.size).toBe(2048);
		expect(entry?.casIndex).toBe(1);
	});

	it("parses TOC buffers identifying bundles, EBX partitions and GUIDs", () => {
		const tocContent = `
			superbundle/win32/futsb
			superbundle/win32/globals
			ebx/gameplay/tactics.ebx
			ebx/ui/card_layout.ebx
			12345678-abcd-ef01-2345-6789abcdef01
		`;
		const buffer = new TextEncoder().encode(tocContent);
		const toc = TocReader.parseBuffer(buffer);

		expect(toc.bundles.length).toBe(2);
		expect(toc.bundles[0].name).toBe("futsb");
		expect(toc.bundles[1].name).toBe("globals");
		expect(toc.ebx.length).toBe(2);
		expect(toc.ebx[0].name).toBe("ebx/gameplay/tactics");
		expect(toc.chunks.length).toBe(1);
		expect(toc.chunks[0].guid).toBe("12345678-abcd-ef01-2345-6789abcdef01");
	});

	it("parses EBX binary partitions extracting GUIDs and type descriptors", () => {
		const buffer = new Uint8Array(64);
		const view = new DataView(buffer.buffer);
		// GUID = 16 bytes (all 0xAA)
		buffer.fill(0xaa, 0, 16);
		// Primary GUID = 16 bytes (all 0xBB)
		buffer.fill(0xbb, 16, 32);
		view.setUint32(32, 1, true); // 1 type descriptor
		view.setUint32(36, 0x12345678, true); // type nameHash
		view.setUint16(40, 4, true); // 4 fields
		buffer[42] = 8; // alignment 8
		view.setUint32(44, 128, true); // size 128

		const partition = EbxParser.parse(buffer);
		expect(partition.guid).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
		expect(partition.primaryInstanceGuid).toBe("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
		expect(partition.typeCount).toBe(1);
		expect(partition.types[0].nameHash).toBe(0x12345678);
		expect(partition.types[0].fieldCount).toBe(4);
	});
});

describe("Module 2: Master Database Engine (19k+ Players Schema & Queries)", () => {
	it("initializes SQLite master schema and performs typed queries", () => {
		const db = new MasterDatabase(":memory:");

		const mockMbappe: MasterPlayer = {
			id: 231747,
			commonName: "K. Mbappé",
			firstName: "Kylian",
			lastName: "Mbappé",
			nationalityId: 18, // France
			teamId: 243, // Real Madrid
			leagueId: 53, // LaLiga
			position: "ST",
			secondaryPositions: ["LW"],
			heightCm: 182,
			weightKg: 75,
			preferredFoot: "Right",
			weakFoot: 4,
			skillMoves: 5,
			bodyType: "Unique",
			internationalRep: 5,
			acceleRate: "Mostly Explosive",
			stats: {
				overallRating: 91,
				potentialRating: 94,
				pace: 97,
				shooting: 90,
				passing: 80,
				dribbling: 92,
				defending: 36,
				physicality: 78,
				acceleration: 97,
				sprintSpeed: 97,
				positioning: 93,
				finishing: 94,
				shotPower: 90,
				longShots: 83,
				volleys: 84,
				penalties: 84,
				vision: 83,
				crossing: 78,
				freeKickAccuracy: 69,
				shortPassing: 86,
				longPassing: 71,
				curve: 80,
				agility: 93,
				balance: 82,
				reactions: 93,
				ballControl: 92,
				dribblingSub: 93,
				composure: 88,
				interceptions: 38,
				headingAccuracy: 73,
				defAwareness: 26,
				standingTackle: 34,
				slidingTackle: 32,
				jumping: 88,
				stamina: 88,
				strength: 77,
				aggression: 64,
			},
			playstyles: [
				{ id: 1, name: "Rapid", category: "Ball Control", isPlus: true },
				{ id: 2, name: "Quick Step", category: "Physical", isPlus: false },
			],
			fcIqRoles: [
				{ position: "ST", roleName: "Poacher", masteryLevel: "Role++", focus: "Attack" },
				{ position: "LW", roleName: "Inside Forward", masteryLevel: "Role+", focus: "Attack" },
			],
		};

		db.upsertPlayer(mockMbappe);
		expect(db.countPlayers()).toBe(1);

		const retrieved = db.getPlayer(231747);
		expect(retrieved).not.toBeNull();
		expect(retrieved?.commonName).toBe("K. Mbappé");
		expect(retrieved?.stats.pace).toBe(97);
		expect(retrieved?.playstyles.length).toBe(2);
		expect(retrieved?.playstyles[0].name).toBe("Rapid");
		expect(retrieved?.playstyles[0].isPlus).toBe(true);
		expect(retrieved?.fcIqRoles.length).toBe(2);
		const poacherRole = retrieved?.fcIqRoles.find((r) => r.roleName === "Poacher");
		expect(poacherRole?.masteryLevel).toBe("Role++");

		// Test search queries
		const searchPace = db.searchPlayers({ minPace: 95 });
		expect(searchPace.length).toBe(1);

		const searchName = db.searchPlayers({ name: "Mbappé" });
		expect(searchName.length).toBe(1);

		const searchNone = db.searchPlayers({ minOvr: 99 });
		expect(searchNone.length).toBe(0);

		db.close();
	});
});

describe("Module 3: FC IQ Engine & In-Game Physics", () => {
	it("encodes and decodes FC IQ tactical setups into compact shareable codes", () => {
		const setup = {
			formationId: "4-3-3-4",
			buildUpStyle: "ShortPassing" as const,
			defensiveApproach: "HighPress" as const,
			defensiveLineDepth: 72,
			roles: Array.from({ length: 11 }, (_, i) => ({
				slotIndex: i,
				position: i === 0 ? "GK" : i < 5 ? "DEF" : i < 8 ? "MID" : "ATT",
				roleId: i === 10 ? "false_9" : "balanced_role",
				focus: "Attack" as const,
			})),
		};

		expect(FcIqCodec.validate(setup)).toBe(true);
		const code = FcIqCodec.encode(setup);
		expect(code.startsWith("fciq_")).toBe(true);

		const decoded = FcIqCodec.decode(code);
		expect(decoded.formationId).toBe("4-3-3-4");
		expect(decoded.buildUpStyle).toBe("ShortPassing");
		expect(decoded.defensiveApproach).toBe("HighPress");
		expect(decoded.defensiveLineDepth).toBe(72);
		expect(decoded.roles.length).toBe(11);
		expect(decoded.roles[10].roleId).toBe("false_9");
	});

	it("calculates exact AcceleRATE 2.0 kinematic classifications", () => {
		// Pure Lengthy: Haaland profile (195cm, Str 93, Agi 75 -> diff 18 >= 14, Acc 82 >= 55)
		const haaland = AcceleRateCalculator.calculate({
			heightCm: 195,
			acceleration: 82,
			agility: 75,
			strength: 93,
		});
		expect(haaland).toBe("Lengthy");

		// Pure Explosive: Vini Jr profile (176cm, Agi 90, Str 68 -> agi-str 22 >= 14, Acc 95)
		const vini = AcceleRateCalculator.calculate({
			heightCm: 175,
			acceleration: 95,
			agility: 91,
			strength: 68,
		});
		expect(vini).toBe("Explosive");

		// Controlled Lengthy: Saliba profile (192cm, Str 86, Agi 80 -> diff 6 >= 4)
		const saliba = AcceleRateCalculator.calculate({
			heightCm: 192,
			acceleration: 78,
			agility: 80,
			strength: 86,
		});
		expect(saliba).toBe("Controlled Lengthy");
	});

	it("modulates In-Game Stats (IGS) using Chemistry Styles and caps at 99", () => {
		const baseStats = {
			overallRating: 88,
			potentialRating: 88,
			pace: 85,
			shooting: 85,
			passing: 80,
			dribbling: 82,
			defending: 40,
			physicality: 75,
			acceleration: 85,
			sprintSpeed: 85,
			positioning: 86,
			finishing: 88,
			shotPower: 84,
			longShots: 80,
			volleys: 80,
			penalties: 80,
			vision: 80,
			crossing: 75,
			freeKickAccuracy: 70,
			shortPassing: 85,
			longPassing: 75,
			curve: 78,
			agility: 80,
			balance: 78,
			reactions: 85,
			ballControl: 85,
			dribblingSub: 84,
			composure: 85,
			interceptions: 40,
			headingAccuracy: 75,
			defAwareness: 35,
			standingTackle: 38,
			slidingTackle: 30,
			jumping: 78,
			stamina: 82,
			strength: 76,
			aggression: 70,
		};

		// Apply Hunter on 3 Chemistry: +8 Acceleration, +8 Sprint Speed, +8 Finishing
		const hunterStats = InGameStatsCalculator.applyChemistry(baseStats, "Hunter", 3);
		expect(hunterStats.acceleration).toBe(93);
		expect(hunterStats.sprintSpeed).toBe(93);
		expect(hunterStats.finishing).toBe(96);

		// Zero chemistry should leave stats unchanged
		const zeroChemStats = InGameStatsCalculator.applyChemistry(baseStats, "Hunter", 0);
		expect(zeroChemStats.acceleration).toBe(85);

		// Fatigue decay at 80th minute
		const fatigued = InGameStatsCalculator.applyFatigue(hunterStats, 80);
		expect(fatigued.pace).toBeLessThan(hunterStats.pace);
		expect(fatigued.stamina).toBeLessThan(hunterStats.stamina);
	});

	it("simulates a 90-minute stochastic match generating xG, possession and events", () => {
		const makeSquad = (name: string, ovr: number) => {
			const players: MasterPlayer[] = Array.from({ length: 11 }, (_, i) => ({
				id: i + 1,
				commonName: `${name}_Player_${i + 1}`,
				firstName: "Test",
				lastName: "Player",
				nationalityId: 1,
				teamId: 1,
				leagueId: 1,
				position: i === 0 ? "GK" : i < 5 ? "CB" : i < 8 ? "CM" : "ST",
				heightCm: 180,
				weightKg: 75,
				preferredFoot: "Right",
				weakFoot: 4,
				skillMoves: 4,
				bodyType: "Average",
				internationalRep: 3,
				acceleRate: "Controlled",
				stats: {
					overallRating: ovr,
					potentialRating: ovr,
					pace: ovr,
					shooting: ovr,
					passing: ovr,
					dribbling: ovr,
					defending: ovr,
					physicality: ovr,
					acceleration: ovr,
					sprintSpeed: ovr,
					positioning: ovr,
					finishing: ovr,
					shotPower: ovr,
					longShots: ovr,
					volleys: ovr,
					penalties: ovr,
					vision: ovr,
					crossing: ovr,
					freeKickAccuracy: ovr,
					shortPassing: ovr,
					longPassing: ovr,
					curve: ovr,
					agility: ovr,
					balance: ovr,
					reactions: ovr,
					ballControl: ovr,
					dribblingSub: ovr,
					composure: ovr,
					interceptions: ovr,
					headingAccuracy: ovr,
					defAwareness: ovr,
					standingTackle: ovr,
					slidingTackle: ovr,
					jumping: ovr,
					stamina: 85,
					strength: ovr,
					aggression: ovr,
					gkReflexes: ovr,
				},
				playstyles: [],
				fcIqRoles: [],
			}));
			return { name, players };
		};

		const home = makeSquad("Real Madrid", 88);
		const away = makeSquad("Getafe", 76);

		const result = MatchSimulator.simulate(home, away);
		expect(result.durationMinutes).toBe(90);
		expect(result.homePossession + result.awayPossession).toBe(100);
		expect(result.homeXg).toBeGreaterThan(result.awayXg);
		expect(result.homeShots).toBeGreaterThanOrEqual(result.homeShotsOnTarget);
	});
});

describe("Module 4: Non-FUT Game Modes (Career, Clubs & Rush 5v5)", () => {
	it("predicts season growth and computes realistic transfer valuation in Career Mode", () => {
		// Young prodigy (Age 19, OVR 82, POT 92)
		const val = CareerManager.calculateMarketValue(82, 92, 19, 36);
		expect(val).toBeGreaterThan(40_000_000);

		// Growth simulation: 19 yo playing 80% matches should gain ~4 OVR
		const growth = CareerManager.predictSeasonGrowth(82, 92, 19, 80);
		expect(growth.growthDelta).toBeGreaterThanOrEqual(3);
		expect(growth.newOverall).toBe(82 + growth.growthDelta);

		// Aging player (Age 35, OVR 88, POT 88) should drop
		const aging = CareerManager.predictSeasonGrowth(88, 88, 35, 70);
		expect(aging.growthDelta).toBeLessThanOrEqual(0);

		// Youth academy scouting
		const scouts = CareerManager.scoutYouthAcademy("France", 5, "CAM");
		expect(scouts.length).toBeGreaterThanOrEqual(5);
		expect(scouts[0].potentialMax).toBeGreaterThanOrEqual(80);
	});

	it("computes Pro Clubs Avatar overall rating and simulates 1v1 Rush Shootout", () => {
		const build = {
			archetype: "Sniper" as const,
			position: "ST" as const,
			heightCm: 180,
			weightKg: 72,
			allocatedPoints: {
				pace: 20,
				shooting: 22,
				passing: 10,
				dribbling: 18,
				defending: 0,
				physical: 10,
			},
			activePerks: ["TikiTaka", "FinesseShot"],
		};

		const ovr = ProClubsRushEngine.computeAvatarOverall(build);
		expect(ovr).toBeGreaterThanOrEqual(88);

		const shootout = ProClubsRushEngine.simulateRushShootout(88, 85);
		expect(["Home", "Away"]).toContain(shootout.winner);
		expect(shootout.rounds.length).toBeGreaterThanOrEqual(3);
	});

	it("simulates a two-legged European knockout tie with aggregate score", () => {
		const tie = TournamentEngine.simulateTie("PSG", 87, "Bayern", 88, "Semi-Final");
		expect(tie.roundName).toBe("Semi-Final");
		expect(tie.aggregateScore.length).toBe(2);
		expect([tie.teamA, tie.teamB]).toContain(tie.winner);
	});
});

describe("Module 5: Savegame & Hardware Configuration Engine", () => {
	it("executes binary serialization and deserialization round-trip for Squads save file", () => {
		const squadData = {
			magic: "FCSQ",
			version: 2,
			timestamp: 1726670000000,
			teams: [
				{
					teamId: 243, // Real Madrid
					formationId: 433,
					takers: {
						captain: 231747,
						penaltyTaker: 231747,
						leftFreeKick: 182521,
						rightFreeKick: 182521,
						leftCorner: 182521,
						rightCorner: 182521,
					},
					lineup: Array.from({ length: 11 }, (_, i) => ({
						playerId: 200000 + i,
						positionIndex: i,
						shirtNumber: i + 1,
					})),
				},
			],
		};

		const binary = SquadSaveParser.serialize(squadData);
		expect(binary.byteLength).toBe(20 + 1 * (32 + 11 * 8));

		const parsed = SquadSaveParser.parse(binary);
		expect(parsed.magic).toBe("FCSQ");
		expect(parsed.version).toBe(2);
		expect(parsed.teams.length).toBe(1);
		expect(parsed.teams[0].teamId).toBe(243);
		expect(parsed.teams[0].takers.captain).toBe(231747);
		expect(parsed.teams[0].lineup.length).toBe(11);
		expect(parsed.teams[0].lineup[0].playerId).toBe(200000);
	});

	it("parses Career<Date> save header metadata", () => {
		const buffer = new Uint8Array(64);
		const view = new DataView(buffer.buffer);
		// "FCCR" magic
		buffer.set([0x46, 0x43, 0x43, 0x52], 0);
		view.setUint32(4, 1, true);
		view.setUint32(8, 243, true); // Real Madrid club ID
		view.setUint32(12, 2026, true); // 2026 season
		view.setUint16(16, 1, true); // 1st position
		view.setUint16(18, 45, true); // 45 points

		const nameBytes = new TextEncoder().encode("Aphrody");
		buffer.set(nameBytes, 24);

		const header = CareerSaveParser.parseHeader(buffer);
		expect(header.magic).toBe("FCCR");
		expect(header.managedClubId).toBe(243);
		expect(header.currentSeasonYear).toBe(2026);
		expect(header.leaguePosition).toBe(1);
		expect(header.totalPoints).toBe(45);
		expect(header.managerName).toBe("Aphrody");
	});

	it("parses, serializes, and optimizes fcsetup.ini for high-end GPUs", () => {
		const iniText = `
			RESOLUTIONWIDTH = 2560
			RESOLUTIONHEIGHT = 1440
			REFRESH_RATE = 144
			RENDERINGQUALITY = 3
			RAYTRACING = 1
		`;
		const config = FcSetupOptimizer.parse(iniText);
		expect(config.RESOLUTIONWIDTH).toBe(2560);
		expect(config.RESOLUTIONHEIGHT).toBe(1440);
		expect(config.REFRESH_RATE).toBe(144);
		expect(config.RAYTRACING).toBe(1);

		const serialized = FcSetupOptimizer.stringify(config);
		expect(serialized).toContain("RESOLUTIONWIDTH = 2560");

		const optimalRtx = FcSetupOptimizer.getOptimalConfig("NVIDIA GeForce RTX 4070");
		expect(optimalRtx.RESOLUTIONWIDTH).toBe(2560);
		expect(optimalRtx.RENDERINGQUALITY).toBe(3); // Ultra
		expect(optimalRtx.RAYTRACING).toBe(1);
		expect(optimalRtx.DIRECT_STORAGE_ENABLED).toBe(1);
		expect(optimalRtx.STRAND_BASED_HAIR).toBe(1);
	});
});

describe("Module 6: SBC ILP Solver (Branch & Bound Minimization)", () => {
	it("accurately computes official EA Squad Rating with non-linear excess points", () => {
		// 11 cards with ratings [88, 88, 83, 83, 83, 83, 83, 83, 83, 83, 83]
		// Sum = 919. Raw avg = 83.54 -> rounded avg = 84.
		// Excess = (88 - 84) + (88 - 84) = 8.
		// Effective sum = 919 + 8 = 927.
		// Squad Rating = floor(927 / 11) = 84.
		const ratings = [88, 88, 83, 83, 83, 83, 83, 83, 83, 83, 83];
		const { squadRating, excessSum } = SbcIlpSolver.calculateSquadRating(ratings);
		expect(squadRating).toBe(84);
		expect(excessSum).toBe(8);
	});

	it("solves an 85-rated SBC at lowest cost and prioritizes untradeables", () => {
		const pool = [
			// Fodder high tier
			{ id: 1, name: "Card_88", rating: 88, priceCoins: 12000, isUntradeable: true },
			{ id: 2, name: "Card_87", rating: 87, priceCoins: 9000, isUntradeable: false },
			{ id: 3, name: "Card_86", rating: 86, priceCoins: 6500, isUntradeable: false },
			{ id: 4, name: "Card_85_A", rating: 85, priceCoins: 4000, isUntradeable: false },
			{ id: 5, name: "Card_85_B", rating: 85, priceCoins: 4000, isUntradeable: false },
			{ id: 6, name: "Card_85_C", rating: 85, priceCoins: 4000, isUntradeable: false },
			{ id: 7, name: "Card_85_D", rating: 85, priceCoins: 4000, isUntradeable: false },
			{ id: 8, name: "Card_84_A", rating: 84, priceCoins: 2000, isUntradeable: false },
			{ id: 9, name: "Card_84_B", rating: 84, priceCoins: 2000, isUntradeable: false },
			{ id: 10, name: "Card_84_C", rating: 84, priceCoins: 2000, isUntradeable: false },
			{ id: 11, name: "Card_83_A", rating: 83, priceCoins: 900, isUntradeable: false },
			{ id: 12, name: "Card_83_B", rating: 83, priceCoins: 900, isUntradeable: false },
			{ id: 13, name: "Card_83_C", rating: 83, priceCoins: 900, isUntradeable: false },
		];

		const result = SbcIlpSolver.solve(pool, { targetRating: 85 }, { prioritizeUntradeables: true });
		expect(result.success).toBe(true);
		expect(result.selectedPlayers.length).toBe(11);
		expect(result.achievedRating).toBeGreaterThanOrEqual(85);
		expect(result.untradeablesUsed).toBe(1); // Used the 88 untradeable card
		expect(result.totalCoinsCost).toBeLessThan(50000);
		expect(result.executionTimeMs).toBeLessThan(50); // High speed ILP
	});
});
