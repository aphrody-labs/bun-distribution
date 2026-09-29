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

import { Browser } from "@aphrody/bxc";
async function launchGhostBrowser(): Promise<{ page: any; close: () => Promise<void> }> {
	const page = await Browser.newPage({ profile: "http" });
	return { page, close: () => page.close() };
}
import pRetry, { AbortError } from "p-retry";
import type { FutPlayer } from "./types.ts";
import {
	decodeEaPlayStyleNames,
	decodeEaRoleNames,
	decodeEaPosition,
} from "./data/fc27_taxonomy.ts";

export function extractTsrPlayer(html: string): FutPlayer | null {
	const match = html.match(/id="\$tsr-stream-barrier"[^>]*>([\s\S]*?)<\/script>/);
	if (!match) return null;
	const tsr = match[1];

	const getStr = (key: string) => {
		const m = tsr.match(new RegExp(`${key}:"([^"]+)"`));
		return m ? m[1] : undefined;
	};
	const getNum = (key: string) => {
		const m = tsr.match(new RegExp(`${key}:([0-9]+)`));
		return m ? parseInt(m[1], 10) : undefined;
	};
	const getNumArray = (key: string) => {
		const m =
			tsr.match(new RegExp(`${key}:\\$R\\[[0-9]+\\]=\\[([0-9,]+)\\]`)) ||
			tsr.match(new RegExp(`${key}:\\[([0-9,]+)\\]`));
		if (!m) return [];
		return m[1]
			.split(",")
			.map((s) => parseInt(s.trim(), 10))
			.filter((n) => !isNaN(n));
	};

	const nickname = getStr("nickname");
	const firstName = getStr("firstName") || "";
	const lastName = getStr("lastName") || "";
	const name = nickname || `${firstName} ${lastName}`.trim();
	if (!name && !getStr("searchableName")) return null;

	const rating = getNum("overall") || 85;
	const posId = getNum("position") ?? 14;
	const position = decodeEaPosition(posId);

	const altPosIds = getNumArray("alternativePositionIds");
	const alternativePositions = altPosIds.map(decodeEaPosition);

	const psIds = getNumArray("playstyles");
	const playstyles = decodeEaPlayStyleNames(psIds, false);

	const pspIds = getNumArray("playstylesPlus");
	const playstylesPlus = decodeEaPlayStyleNames(pspIds, true);

	const rolesPlusIds = getNumArray("rolesPlus");
	const rolesPlusPlusIds = getNumArray("rolesPlusPlus");
	const rolesPlus = decodeEaRoleNames(rolesPlusIds);
	const rolesPlusPlus = decodeEaRoleNames(rolesPlusPlusIds);

	/** fut.gg slugs look like `73-paris-saint-germain`; drop the id, title-case the rest. */
	const fromSlug = (slug?: string): string | undefined =>
		slug
			? slug.replace(/^[0-9]+-/, "").replace(/-/g, " ").toUpperCase()
			: undefined;

	const club = fromSlug(getStr("uniqueClubSlug"));
	// Nation and league are only reported when the payload actually carries them.
	// They used to be hard-coded to "Portugal" / "Ligue 1" for every player, which
	// silently mislabelled every scraped card; an absent field beats a wrong one.
	const nation = fromSlug(getStr("uniqueNationSlug") ?? getStr("nationSlug"));
	const league = fromSlug(getStr("uniqueLeagueSlug") ?? getStr("leagueSlug"));

	return {
		name: name || getStr("searchableName")?.split(" ")[0] || "Unknown Player",
		rating,
		overallRating: rating,
		position,
		alternativePositions,
		club,
		nation,
		league,
		playstyles,
		playstylesPlus,
		// Decoded above and previously dropped: the FC IQ roles and their
		// familiarity tier are what the in-game player detail screen leads with.
		rolesPlus,
		rolesPlusPlus,
		// Every face stat is optional in the schema: report what the payload has
		// rather than falling back to another player's numbers.
		pac: getNum("facePace"),
		sho: getNum("faceShooting"),
		pas: getNum("facePassing"),
		dri: getNum("faceDribbling"),
		def: getNum("faceDefending"),
		phy: getNum("facePhysicality"),
		acceleration: getNum("attributeAcceleration"),
		sprintSpeed: getNum("attributeSprintSpeed"),
		agility: getNum("attributeAgility"),
		balance: getNum("attributeBalance"),
		reactions: getNum("attributeReactions"),
		ballControl: getNum("attributeBallControl"),
		dribbling: getNum("attributeDribbling"),
		composure: getNum("attributeComposure"),
		jumping: getNum("attributeJumping"),
		stamina: getNum("attributeStamina"),
		strength: getNum("attributeStrength"),
		aggression: getNum("attributeAggression"),
		interceptions: getNum("attributeInterceptions"),
		headingAccuracy: getNum("attributeHeadingAccuracy"),
		defensiveAwareness: getNum("attributeDefensiveAwareness"),
		standingTackle: getNum("attributeStandingTackle"),
		slidingTackle: getNum("attributeSlidingTackle"),
		vision: getNum("attributeVision"),
		crossing: getNum("attributeCrossing"),
		fkAccuracy: getNum("attributeFkAccuracy"),
		shortPassing: getNum("attributeShortPassing"),
		longPassing: getNum("attributeLongPassing"),
		curve: getNum("attributeCurve"),
		positioning: getNum("attributePositioning"),
		finishing: getNum("attributeFinishing"),
		shotPower: getNum("attributeShotPower"),
		longShots: getNum("attributeLongShots"),
		volleys: getNum("attributeVolleys"),
		penalties: getNum("attributePenalties"),
		skillMoves: getNum("skillMoves") ?? 3,
		weakFoot: getNum("weakFoot") ?? 4,
		foot: getNum("foot") === 2 ? "Left" : "Right",
		height: getNum("height") ?? 174,
		weight: getNum("weight") ?? 66,
		accelerateType: getStr("accelerateType") || "Controlled",
		gender: getNum("gender") === 2 ? "Women" : "Men",
	};
}

export async function scrapeFutGgPlayer(
	urlOrHtml: string,
	profile: "static" | "http" = "static",
): Promise<FutPlayer> {
	let content = "";
	let title = "";

	if (urlOrHtml.startsWith("http://") || urlOrHtml.startsWith("https://")) {
		// Tier 1: Try zero-spawn fast ImpersonatedClient (Chrome 131)
		try {
			const { ImpersonatedClient } = await import("@aphrody/bxc/ffi/curl-impersonate");
			const imp = new ImpersonatedClient({ profile: "chrome131" });
			const res = await imp.fetch(urlOrHtml);
			if (res.status === 200) {
				const body = await res.text();
				if (!body.includes("Just a moment...") && !body.includes("cf-browser-verification")) {
					content = body;
					const titleMatch = body.match(/<title>([^<]+)<\/title>/);
					title = titleMatch ? titleMatch[1] : "";
				}
			}
		} catch {
			// Fallback to browser execution
		}

		if (!content) {
			const fetched = await pRetry(
				async () => {
					if (false) {
						const ghost = await launchGhostBrowser();
						try {
							const res = await ghost.page.goto(urlOrHtml);
							await Bun.sleep(2000);
							const content = await ghost.page.content();
							const title = await ghost.page.title();
							if (
								title.includes("Just a moment") ||
								title.includes("Cloudflare")
							) {
								throw new AbortError("Cloudflare Turnstile challenge detected");
							}
							if (res && res.status === 404) {
								throw new AbortError(`404 Not Found: ${urlOrHtml}`);
							}
							return { content, title };
						} finally {
							await ghost.close();
						}
					} else {
						const page = await Browser.newPage({ profile });
						try {
							const res = await page.goto(urlOrHtml);
							const title = await page.title();
							if (
								title.includes("Just a moment") ||
								title.includes("Cloudflare")
							) {
								throw new AbortError("Cloudflare Turnstile challenge detected");
							}
							if (res && res.status === 404) {
								throw new AbortError(`404 Not Found: ${urlOrHtml}`);
							}
							if (res && res.status >= 500) {
								throw new Error(`Server error ${res.status}: ${urlOrHtml}`);
							}
							const content = await page.content();
							return { content, title };
						} finally {
							await page.close();
						}
					}
				},
				{
					retries: 2,
					onFailedAttempt: (failedAttempt) => {
						console.warn(
							`  [Retry FutGg] Attempt ${failedAttempt.attemptNumber} failed. ${failedAttempt.retriesLeft} retries left. Error: ${(failedAttempt as any).error?.message || (failedAttempt as any).message || String(failedAttempt)}`,
						);
					},
				},
			);
			content = fetched.content;
			title = fetched.title;
		}
	} else {
		content = urlOrHtml;
	}

	// Fast path: Extract rich TanStack Router payload if available
	const tsrParsed = extractTsrPlayer(content);
	if (tsrParsed) {
		return tsrParsed;
	}

	let name = "";
	let ratingStr = "";
	let positionStr = "";
	const playstyles: string[] = [];

	// Use Bun's native HTMLRewriter (Web API) for fast, zero-dependency streaming parse
	const rewriter = new HTMLRewriter()
		.on("h1", {
			text(chunk) {
				name += chunk.text;
			},
		})
		.on(".player-item-rating", {
			text(chunk) {
				ratingStr += chunk.text;
			},
		})
		.on(".player-item-position", {
			text(chunk) {
				positionStr += chunk.text;
			},
		});

	// Transform content HTML natively
	const response = new Response(content);
	await rewriter.transform(response).text();

	// Clean up parsed properties
	name = name.trim();
	if (!name) {
		name = title.split("-")[0]?.trim() || "Unknown Player";
	}

	const rating = parseInt(ratingStr.trim(), 10) || 85;
	let position = positionStr.trim().toUpperCase() || "ST";

	// Fallback to robust heuristics if selectors returned empty (e.g. Cloudflare challenged page structure)
	if (position === "ST") {
		const posHeuristic =
			new RegExp(
				`${rating}\\s*\\b(CM|CDM|CAM|ST|RW|LW|CF|CB|LB|RB|LWB|RWB|GK)\\b`,
				"i",
			).exec(content) ||
			/\b(CM|CDM|CAM|ST|RW|LW|CF|CB|LB|RB|LWB|RWB|GK)\b/i.exec(content);
		if (posHeuristic) {
			position = posHeuristic[1].toUpperCase();
		}
	}

	// 2. Extract Club, Nation, and League using high-speed native Rust FFI DOM Tree
	let nativeClub: string | undefined = undefined;
	let nativeNation: string | undefined = undefined;
	let nativeLeague: string | undefined = undefined;

	try {
		const { parseHtml, querySelector, destroyTree } = await import(
			"@aphrody/bxc/ffi/rust-bridge"
		);
		const tree = parseHtml(content);
		if (tree) {
			try {
				const clubHtml = querySelector(tree, 'a[href*="/clubs/"]');
				if (clubHtml) {
					nativeClub = clubHtml.replace(/<[^>]+>/g, "").trim() || undefined;
				}
				const nationHtml = querySelector(tree, 'a[href*="/nations/"]');
				if (nationHtml) {
					nativeNation = nationHtml.replace(/<[^>]+>/g, "").trim() || undefined;
				}
				const leagueHtml = querySelector(tree, 'a[href*="/leagues/"]');
				if (leagueHtml) {
					nativeLeague = leagueHtml.replace(/<[^>]+>/g, "").trim() || undefined;
				}
			} finally {
				destroyTree(tree);
			}
		}
	} catch {
		// Ignore Rust FFI error, fall back to RegExp
	}

	const clubMatch =
		/href="\/clubs\/([^/"]+)\/?"[^>]*>(?:<[^>]+>)*\s*([^<]+)\s*(?:<\/[^>]+>)*\s*<\/a>/i.exec(
			content,
		);
	const club =
		nativeClub ||
		(clubMatch
			? clubMatch[2]
					.replace(/&#x27;/g, "'")
					.replace(/&amp;/g, "&")
					.trim()
			: undefined);

	const nationMatch =
		/href="\/nations\/([^/"]+)\/?"[^>]*>(?:<[^>]+>)*\s*([^<]+)\s*(?:<\/[^>]+>)*\s*<\/a>/i.exec(
			content,
		);
	const nation =
		nativeNation ||
		(nationMatch
			? nationMatch[2]
					.replace(/&#x27;/g, "'")
					.replace(/&amp;/g, "&")
					.trim()
			: undefined);

	const leagueMatch =
		/href="\/leagues\/([^/"]+)\/?"[^>]*>(?:<[^>]+>)*\s*([^<]+)\s*(?:<\/[^>]+>)*\s*<\/a>/i.exec(
			content,
		);
	const league =
		nativeLeague ||
		(leagueMatch
			? leagueMatch[2]
					.replace(/&#x27;/g, "'")
					.replace(/&amp;/g, "&")
					.trim()
			: undefined);

	// 3. Extract standard Stats (PAC, SHO, PAS, DRI, DEF, PHY) or Goalkeeper Stats (DIV, HAN, KIC, REF, SPD, POS)
	const stats: Record<string, number> = {};
	const statNames = ["PAC", "SHO", "PAS", "DRI", "DEF", "PHY"];
	for (const stat of statNames) {
		const regex = new RegExp(
			`${stat}<\\/div><div class="[^"]*">(\\d{2})<\\/div>`,
			"i",
		);
		const match = regex.exec(content);
		if (match && match[1]) {
			stats[stat.toLowerCase()] = parseInt(match[1], 10);
		}
	}

	const gkStats: Record<string, number> = {};
	const gkStatNames = ["DIV", "HAN", "KIC", "REF", "SPD", "POS"];
	for (const stat of gkStatNames) {
		const regex = new RegExp(
			`${stat}<\\/div><div class="[^"]*">(\\d{2})<\\/div>`,
			"i",
		);
		const match = regex.exec(content);
		if (match && match[1]) {
			gkStats[stat.toLowerCase()] = parseInt(match[1], 10);
		}
	}

	const hasStandardStats = Object.keys(stats).length > 0;
	const hasGkStats = Object.keys(gkStats).length > 0;

	// Identify generic hub/listing pages (if a page has no stats at all, it's generic)
	const isGeneric =
		(!hasStandardStats && !hasGkStats) ||
		name.includes("Players") ||
		name.includes("Evolutions") ||
		name.includes("SBCs") ||
		name.toLowerCase().includes("squad builder") ||
		name.toLowerCase().includes("sbc solutions");

	// 4. Extract Weak Foot and Skill Moves
	const smMatch =
		/\bSkill\s+Moves\s*:\s*(\d)/i.exec(content) ||
		/(\d)\s*(?:star|★)\s*Skill\s+Moves/i.exec(content) ||
		/Skill\s+Moves\s*(\d)/i.exec(content);
	let skillMoves = smMatch ? parseInt(smMatch[1], 10) : undefined;
	if (skillMoves === undefined) {
		const smSerMatch = /\bskillMoves\s*:\s*(\d+)/.exec(content);
		if (smSerMatch) skillMoves = parseInt(smSerMatch[1], 10);
	}

	const wfMatch =
		/\bWeak\s+Foot\s*:\s*(\d)/i.exec(content) ||
		/(\d)\s*(?:star|★)\s*Weak\s+Foot/i.exec(content) ||
		/Weak\s+Foot\s*(\d)/i.exec(content);
	let weakFoot = wfMatch ? parseInt(wfMatch[1], 10) : undefined;
	if (weakFoot === undefined) {
		const wfSerMatch = /\bweakFoot\s*:\s*(\d+)/.exec(content);
		if (wfSerMatch) weakFoot = parseInt(wfSerMatch[1], 10);
	}

	// 5. Extract Workrates
	const wrMatch =
		/Work\s*Rates?\s*:\s*([HLM][a-z]+)\s*\/\s*([HLM][a-z]+)/i.exec(content);
	let workrateAttack = wrMatch ? wrMatch[1].trim() : undefined;
	let workrateDefense = wrMatch ? wrMatch[2].trim() : undefined;
	if (workrateAttack === undefined || workrateDefense === undefined) {
		const wraSerMatch =
			/\battackingWorkrate\s*:\s*(?:"([^"]+)"|([a-z]+|null))/.exec(content);
		const wrdSerMatch =
			/\bdefensiveWorkrate\s*:\s*(?:"([^"]+)"|([a-z]+|null))/.exec(content);
		if (wraSerMatch && wraSerMatch[1]) workrateAttack = wraSerMatch[1];
		if (wrdSerMatch && wrdSerMatch[1]) workrateDefense = wrdSerMatch[1];
	}

	// 6. Differentiate standard Playstyles and Playstyles+ (Plus)
	const playstylesPlus: string[] = [];
	const playstylesSet = new Set<string>();
	const playstylesPlusSet = new Set<string>();

	const playstyleBlockRegex =
		/<div class="relative table[^"]*">([\s\S]*?)<span class="overflow-hidden">([^<]+)<\/span>/g;
	let psMatch;
	while ((psMatch = playstyleBlockRegex.exec(content)) !== null) {
		const block = psMatch[1];
		const name = psMatch[2].trim();
		if (block.toLowerCase().includes("#e3c075")) {
			playstylesPlusSet.add(name);
		} else {
			playstylesSet.add(name);
		}
	}

	// Fallback to regex checks if HTML structure parsing found nothing (e.g. mock HTML or altered markup)
	if (playstylesSet.size === 0 && playstylesPlusSet.size === 0) {
		const KNOWN_PLAYSTYLES = [
			"Jockey",
			"Intercept",
			"Anticipate",
			"Block",
			"Bruiser",
			"Slide Tackle",
			"Power Header",
			"Finesse Shot",
			"Power Shot",
			"Dead Ball",
			"Chip Shot",
			"Pinged Pass",
			"Incisive Pass",
			"Long Ball Pass",
			"Long Ball",
			"Tiki Taka",
			"Whipped Pass",
			"First Touch",
			"Flair",
			"Press Proven",
			"Rapid",
			"Technical",
			"Trickster",
			"Quick Step",
			"Relentless",
			"Trivela",
			"Acrobatic",
			"Aerial",
			"Aerial Fortress",
		];
		for (const ps of KNOWN_PLAYSTYLES) {
			const plusRegex = new RegExp(`\\b${ps}\\+|\\b${ps}\\s+Plus\\b`, "i");
			if (plusRegex.test(content)) {
				playstylesPlusSet.add(ps);
			} else {
				const normalRegex = new RegExp(`\\b${ps}\\b`, "i");
				if (normalRegex.test(content)) {
					playstylesSet.add(ps);
				}
			}
		}
	}

	for (const ps of playstylesSet) {
		playstyles.push(ps);
	}
	for (const ps of playstylesPlusSet) {
		playstylesPlus.push(ps);
	}

	// 7. Parse Biology, Card Attributes, and Detailed Stats from serialized state
	const overallMatch = /\boverall\s*:\s*(\d+)/.exec(content);
	const overallRating = overallMatch
		? parseInt(overallMatch[1], 10)
		: undefined;

	const dobMatch = /\bdateOfBirth\s*:\s*"([^"]+)"/.exec(content);
	const dateOfBirth = dobMatch ? dobMatch[1] : undefined;

	const heightMatch = /\bheight\s*:\s*(\d+)/.exec(content);
	const heightVal = heightMatch ? parseInt(heightMatch[1], 10) : undefined;

	const weightMatch = /\bweight\s*:\s*(\d+)/.exec(content);
	const weightVal = weightMatch ? parseInt(weightMatch[1], 10) : undefined;

	const ageMatch = /\bage\s*:\s*(\d+)/.exec(content);
	const age = ageMatch ? parseInt(ageMatch[1], 10) : undefined;

	const footRawMatch = /\bfoot\s*:\s*(?:"([^"]+)"|(\d+))/.exec(content);
	let foot: string | undefined = undefined;
	if (footRawMatch) {
		if (footRawMatch[1]) {
			foot = footRawMatch[1];
		} else if (footRawMatch[2]) {
			foot = footRawMatch[2] === "2" ? "Left" : "Right";
		}
	}

	const altPosMatch =
		/alternativePositions\s*:\s*(?:\$R\[\d+\]\s*=\s*)?(\[[^\]]*\])/.exec(
			content,
		);
	let alternativePositions: string[] = [];
	if (altPosMatch && altPosMatch[1]) {
		try {
			alternativePositions = JSON.parse(
				altPosMatch[1]
					.replace(/'/g, '"')
					.replace(/!1/g, "false")
					.replace(/!0/g, "true"),
			);
		} catch {}
	}

	const rarityMatch =
		/Rarity<\/span><span[^>]*>(?:<[^>]+>)*\s*([^<]+)\s*(?:<\/[^>]+>)*\s*<\/span>/i.exec(
			content,
		);
	const rarity = rarityMatch ? rarityMatch[1].trim() : undefined;

	const accMatch = /AcceleRATE<\/span><span[^>]*>\s*([^<]+)\s*<\/span>/i.exec(
		content,
	);
	const accelerateType = accMatch ? accMatch[1].trim() : undefined;

	const isWomenMatch = /\bisWomen\s*:\s*(![01]|true|false)/.exec(content);
	const gender =
		isWomenMatch && (isWomenMatch[1] === "!0" || isWomenMatch[1] === "true")
			? "Women"
			: "Men";

	const subStats: Record<string, number> = {};
	const subStatNames = [
		"Acceleration",
		"SprintSpeed",
		"Agility",
		"Balance",
		"Reactions",
		"BallControl",
		"Dribbling",
		"Composure",
		"Jumping",
		"Stamina",
		"Strength",
		"Aggression",
		"Interceptions",
		"HeadingAccuracy",
		"DefensiveAwareness",
		"StandingTackle",
		"SlidingTackle",
		"Vision",
		"Crossing",
		"FkAccuracy",
		"ShortPassing",
		"LongPassing",
		"Curve",
		"Positioning",
		"Finishing",
		"ShotPower",
		"LongShots",
		"Volleys",
		"Penalties",
		"GkDiving",
		"GkHandling",
		"GkKicking",
		"GkReflexes",
		"GkPositioning",
		"GkSpeed",
	];
	for (const statName of subStatNames) {
		const match = new RegExp(
			`\\battribute${statName}\\s*:\\s*(\\d+)`,
			"i",
		).exec(content);
		if (match && match[1]) {
			const key = statName.charAt(0).toLowerCase() + statName.slice(1);
			subStats[key] = parseInt(match[1], 10);
		}
	}

	return {
		name,
		rating,
		position,
		club,
		nation,
		league,
		playstyles,
		playstylesPlus,
		pac: stats.pac,
		sho: stats.sho,
		pas: stats.pas,
		dri: stats.dri,
		def: stats.def,
		phy: stats.phy,
		div: gkStats.div,
		han: gkStats.han,
		kic: gkStats.kic,
		ref: gkStats.ref,
		spd: gkStats.spd,
		pos: gkStats.pos,
		skillMoves,
		weakFoot,
		workrateAttack,
		workrateDefense,
		isGeneric,

		// New expanded biology/card properties
		overallRating,
		dateOfBirth,
		height: heightVal,
		weight: weightVal,
		foot,
		age,
		rarity,
		accelerateType,
		gender,
		alternativePositions,

		// Detailed stats
		acceleration: subStats.acceleration,
		sprintSpeed: subStats.sprintSpeed,
		agility: subStats.agility,
		balance: subStats.balance,
		reactions: subStats.reactions,
		ballControl: subStats.ballControl,
		dribbling: subStats.dribbling,
		composure: subStats.composure,
		jumping: subStats.jumping,
		stamina: subStats.stamina,
		strength: subStats.strength,
		aggression: subStats.aggression,
		interceptions: subStats.interceptions,
		headingAccuracy: subStats.headingAccuracy,
		defensiveAwareness: subStats.defensiveAwareness,
		standingTackle: subStats.standingTackle,
		slidingTackle: subStats.slidingTackle,
		vision: subStats.vision,
		crossing: subStats.crossing,
		fkAccuracy: subStats.fkAccuracy,
		shortPassing: subStats.shortPassing,
		longPassing: subStats.longPassing,
		curve: subStats.curve,
		positioning: subStats.positioning,
		finishing: subStats.finishing,
		shotPower: subStats.shotPower,
		longShots: subStats.longShots,
		volleys: subStats.volleys,
		penalties: subStats.penalties,
		gkDiving: subStats.gkDiving,
		gkHandling: subStats.gkHandling,
		gkKicking: subStats.gkKicking,
		gkReflexes: subStats.gkReflexes,
		gkPositioning: subStats.gkPositioning,
		gkSpeed: subStats.gkSpeed,
	};
}
