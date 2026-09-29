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

import { ImpersonatedClient } from "@aphrody/bxc/ffi/curl-impersonate";
import type { EvolutionItem, EvolutionSimulationResult } from "./types.ts";
import { FutDatabaseRepository } from "../repository/FutDatabaseRepository.ts";

export class FutEvolutionsClient {
	private client: ImpersonatedClient;

	constructor() {
		this.client = new ImpersonatedClient({ profile: "chrome131" });
	}

	/**
	 * Lists all active evolutions directly from fut.gg/evolutions/
	 */
	public async listActiveEvolutions(): Promise<EvolutionItem[]> {
		const res = await this.client.fetch("https://www.fut.gg/evolutions/");
		if (res.status !== 200) {
			throw new Error(`Failed to fetch evolutions hub: HTTP ${res.status}`);
		}
		const html = await res.text();

		const slugMatches = html.match(/\/evolutions\/([0-9]+-[a-z0-9\-]+)\//g) || [];
		const uniqueSlugs = Array.from(
			new Set(slugMatches.map((s) => s.replace(/^\/evolutions\/|\/$/g, ""))),
		);

		const evolutions: EvolutionItem[] = [];
		for (const slug of uniqueSlugs) {
			try {
				const detail = await this.getEvolutionDetail(slug);
				if (detail) evolutions.push(detail);
			} catch {
				// Continue on partial failures
			}
		}

		return evolutions;
	}

	/**
	 * Extracts rich structured evolution metadata from Seroval stream payload.
	 */
	public async getEvolutionDetail(slug: string): Promise<EvolutionItem | null> {
		const url = `https://www.fut.gg/evolutions/${slug}/`;
		const res = await this.client.fetch(url);
		if (res.status !== 200) {
			return null;
		}
		const html = await res.text();

		const scriptTags = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
		let serovalScript = "";
		for (const s of scriptTags) {
			if (s.includes(`/${slug}/`) && s.includes("slug:\"")) {
				serovalScript = s;
				break;
			}
		}

		if (!serovalScript) {
			return null;
		}

		// Extract fields with robust regexes over seroval AST
		const idMatch = serovalScript.match(/id:([0-9]+)/);
		const nameMatch = serovalScript.match(/name:\"([^\"]+)\"/);
		const descMatch = serovalScript.match(/description:\"([^\"]+)\"/);
		const coinsMatch = serovalScript.match(/coinsCost:([0-9]+)/);
		const pointsMatch = serovalScript.match(/pointsCost:([0-9]+)/);
		const numPlayersMatch = serovalScript.match(/numberOfPlayers:([0-9]+)/);
		const endTimeMatch = serovalScript.match(/endTime:\"([^\"]+)\"/);

		const id = idMatch ? parseInt(idMatch[1], 10) : 0;
		const name = nameMatch ? nameMatch[1] : slug;
		const description = descMatch ? descMatch[1] : "";
		const coinsCost = coinsMatch ? parseInt(coinsMatch[1], 10) : 0;
		const pointsCost = pointsMatch ? parseInt(pointsMatch[1], 10) : 0;
		const numberOfPlayersEligible = numPlayersMatch ? parseInt(numPlayersMatch[1], 10) : 0;
		const endTime = endTimeMatch ? endTimeMatch[1] : "";

		// Extract Requirements
		const reqMatch = serovalScript.match(/requirementsText:(?:\$R\[[0-9]+\]=)?\[([\s\S]*?)\](?:,isRewardEvolution|,player)/);
		const requirements: Array<{ label: string; value: string }> = [];
		if (reqMatch) {
			const labelMatches = Array.from(reqMatch[1].matchAll(/label:\"([^\"]+)\",value:\"([^\"]+)\"/g));
			for (const m of labelMatches) {
				requirements.push({ label: m[1], value: m[2] });
			}
		}

		// Extract Total Upgrades
		const upgMatch = serovalScript.match(/totalUpgradesText:(?:\$R\[[0-9]+\]=)?\[([\s\S]*?)\](?:,timedCustom|,sbcName)/);
		const totalUpgrades: Array<{ label: string; value: string; maxValue?: string }> = [];
		if (upgMatch) {
			const upgItems = Array.from(upgMatch[1].matchAll(/label:\"([^\"]+)\",value:\"([^\"]+)\"(?:,maxValue:\"([^\"]+)\")?/g));
			for (const m of upgItems) {
				totalUpgrades.push({ label: m[1], value: m[2], maxValue: m[3] });
			}
		}

		return {
			id,
			slug,
			name,
			description,
			coinsCost,
			pointsCost,
			isFree: coinsCost === 0 && pointsCost === 0,
			numberOfPlayersEligible,
			endTime,
			requirements,
			levels: [],
			totalUpgrades,
		};
	}

	/**
	 * Simulates applying an evolution on a player from our local big data index.
	 */
	public simulateEvolutionOnPlayer(
		playerName: string,
		evolution: EvolutionItem,
	): EvolutionSimulationResult {
		const repo = new FutDatabaseRepository();
		const matches = repo.queryPlayers({ name: playerName, limit: 1 });
		repo.close();

		if (matches.length === 0) {
			throw new Error(`Player not found in local database: ${playerName}`);
		}

		const p = matches[0];
		const upgraded = {
			name: `${p.name} (Evo: ${evolution.name})`,
			rating: p.overallRating,
			pac: p.pac,
			sho: p.sho,
			pas: p.pas,
			dri: p.dri,
			def: p.def,
			phy: p.phy,
			playstyles: [...p.playstyles],
		};

		let totalBoost = 0;
		for (const upg of evolution.totalUpgrades) {
			const val = parseInt(upg.value.replace("+", ""), 10);
			if (isNaN(val)) {
				// Might be a playstyle addition
				if (upg.label === "PlayStyle" && !upgraded.playstyles.includes(upg.value)) {
					upgraded.playstyles.push(upg.value);
				}
				continue;
			}

			const labelLower = upg.label.toLowerCase();
			if (labelLower.includes("overall")) {
				upgraded.rating += val;
			} else if (labelLower.includes("pace")) {
				upgraded.pac += val;
				totalBoost += val;
			} else if (labelLower.includes("shooting")) {
				upgraded.sho += val;
				totalBoost += val;
			} else if (labelLower.includes("passing")) {
				upgraded.pas += val;
				totalBoost += val;
			} else if (labelLower.includes("dribbling")) {
				upgraded.dri += val;
				totalBoost += val;
			} else if (labelLower.includes("defending")) {
				upgraded.def += val;
				totalBoost += val;
			} else if (labelLower.includes("physical")) {
				upgraded.phy += val;
				totalBoost += val;
			}
		}

		return {
			playerOriginal: {
				name: p.name,
				rating: p.overallRating,
				pac: p.pac,
				sho: p.sho,
				pas: p.pas,
				dri: p.dri,
				def: p.def,
				phy: p.phy,
				playstyles: p.playstyles,
			},
			evolutionApplied: evolution.name,
			playerUpgraded: upgraded,
			totalStatBoost: totalBoost,
			costCoins: evolution.coinsCost,
		};
	}
}
