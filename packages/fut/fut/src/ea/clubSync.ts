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

import { FutDatabaseRepository } from "../repository/FutDatabaseRepository.ts";
import { FODDER_PRICE_INDEX } from "../sbc/index.ts";
import type { ClubSyncSummary, UtClubPlayerItem } from "./types.ts";

/**
 * Generates the portable, one-click JavaScript snippet that players can run
 * directly in their browser console (or save as a Bookmarklet) while logged into
 * the official EA SPORTS FC Web App (https://www.ea.com/ea-sports-fc/ultimate-team/web-app/).
 *
 * It paginates through the user's club using the active session and prompts a download
 * of bxc_club_fc27.json without ever exposing passwords.
 */
export function generateWebAppBookmarklet(): string {
	const code = `javascript:(async function(){
  try {
    const sid = window.sessionStorage?.getItem("ut_session") || window.services?.User?.getUser()?._accessToken;
    const year = "27";
    const baseUrl = "https://utas.mob.v1.prd.futc-ext.gcp.ea.com/ut/game/fc" + year;
    console.log("[BXC Club Importer] Démarrage de l'export du club...");
    let offset = 0;
    const count = 90;
    const allPlayers = [];
    while (true) {
      console.log("[BXC Club Importer] Récupération des joueurs " + offset + " à " + (offset + count) + "...");
      const res = await fetch(baseUrl + "/club?count=" + count + "&offset=" + offset + "&type=player", {
        headers: { "X-UT-SID": sid, "Accept": "application/json" }
      });
      if (!res.ok) {
        if (res.status === 401) alert("Session expirée. Veuillez recharger la page Web App.");
        break;
      }
      const data = await res.json();
      const items = data.itemData || [];
      if (items.length === 0) break;
      for (const it of items) {
        allPlayers.push({
          id: it.id,
          assetId: it.assetId,
          resourceId: it.resourceId,
          rating: it.rating,
          itemType: it.itemType,
          rareflag: it.rareflag,
          preferredPosition: it.preferredPosition,
          nation: it.nation,
          leagueId: it.leagueId,
          teamid: it.teamid,
          untradeable: it.untradeable || false,
          discardValue: it.discardValue || 0,
        });
      }
      offset += count;
      if (items.length < count) break;
    }
    console.log("[BXC Club Importer] Total joueurs exportés : " + allPlayers.length);
    const json = JSON.stringify({ syncedAt: new Date().toISOString(), total: allPlayers.length, players: allPlayers }, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bxc_club_fc27.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    alert("✅ Club FC 27 exporté avec succès ! (" + allPlayers.length + " joueurs téléchargés dans bxc_club_fc27.json)");
  } catch (err) {
    alert("Erreur export BXC : " + err.message);
  }
})();`;

	return code.replace(/\n\s*/g, " ");
}

/**
 * Ingests a collection of club players and produces a comprehensive
 * club valuation, fodder audit, and untradeable breakdown.
 */
export function analyzeClubInventory(
	players: UtClubPlayerItem[],
	dbRepo?: FutDatabaseRepository,
): ClubSyncSummary {
	const repo = dbRepo ?? new FutDatabaseRepository();
	let untradeableCount = 0;
	let tradeableCount = 0;
	let totalValueConsole = 0;
	let totalValuePc = 0;

	const fodderCount: Record<number, number> = {
		83: 0,
		84: 0,
		85: 0,
		86: 0,
		87: 0,
		88: 0,
		89: 0,
		90: 0,
		91: 0,
	};

	const processedCards: Array<{
		id: number;
		name?: string;
		rating: number;
		position: string;
		untradeable: boolean;
		estimatedPriceConsole: number;
		estimatedPricePc: number;
	}> = [];

	for (const p of players) {
		if (p.untradeable) {
			untradeableCount++;
		} else {
			tradeableCount++;
		}

		// Count fodder buckets
		if (p.rating >= 83 && p.rating <= 91) {
			fodderCount[p.rating] = (fodderCount[p.rating] ?? 0) + 1;
		} else if (p.rating > 91) {
			fodderCount[91] = (fodderCount[91] ?? 0) + 1;
		}

		// Look up player metadata in local repository by assetId or rating + nation
		let name = p.name;
		if (!name && p.resourceId) {
			const dbPlayer = repo.getPlayerById(String(p.resourceId)) || repo.getPlayerById(String(p.assetId));
			if (dbPlayer) {
				name = dbPlayer.name;
			}
		}

		// Compute estimated baseline value from fodder floor or rating
		const fodderTier = FODDER_PRICE_INDEX.find((f) => f.rating === p.rating);
		const fodderFloor = fodderTier ? fodderTier.averagePriceConsole : (p.rating >= 82 ? 900 : 450);
		const priceConsole = p.untradeable ? 0 : Math.round(fodderFloor * (p.rating >= 88 ? 1.2 : 1.0));
		const pricePc = p.untradeable ? 0 : Math.round(priceConsole * (p.rating >= 88 ? 1.25 : 1.05));

		totalValueConsole += priceConsole;
		totalValuePc += pricePc;

		processedCards.push({
			id: p.id,
			name: name ?? `Joueur OVR ${p.rating}`,
			rating: p.rating,
			position: p.preferredPosition,
			untradeable: p.untradeable,
			estimatedPriceConsole: priceConsole,
			estimatedPricePc: pricePc,
		});
	}

	// Sort top cards by rating descending
	processedCards.sort((a, b) => b.rating - a.rating);

	return {
		syncedAt: new Date().toISOString(),
		totalPlayers: players.length,
		untradeableCount,
		tradeableCount,
		fodderCountByRating: fodderCount,
		estimatedTotalValueCoins: {
			console: totalValueConsole,
			pc: totalValuePc,
		},
		topCards: processedCards.slice(0, 15),
	};
}
