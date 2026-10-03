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

import { fetchFutPage } from "./web.ts";
import type { FutPrice, FutPlatform, FutPlayer } from "./types.ts";
import { parseFutPlatformPrices } from "./parser/native.ts";

/**
 * Extracts structured FutPlayer data from raw FUTBin HTML markup.
 */
export function extractFutbinPlayer(html: string): FutPlayer | null {
  // 1. Name extraction
  let name = "";
  const nameMatch =
    html.match(/class="[^"]*player-name[^"]*">([^<]+)</i) ||
    html.match(/id="player-header"[^>]*>([^<]+)</i) ||
    html.match(/<title>([^<]+?)(?: FC \d+| FIFA \d+| - \d+ - | Rating and Price)/i);
  if (nameMatch) {
    name = nameMatch[1].trim();
  }
  if (!name) {
    const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (h1Match) name = h1Match[1].replace(/\b(?:FC|FIFA)\s*\d+.*$/i, "").trim();
  }
  if (!name) return null;

  // 2. Rating & Position
  let rating = 80;
  const ratMatch =
    html.match(/class="[^"]*pcdisplay-rat[^"]*">(\d+)</i) ||
    html.match(/class="[^"]*player-rating[^"]*">(\d+)</i) ||
    html.match(/ - (\d{2}) - /);
  if (ratMatch) rating = parseInt(ratMatch[1], 10);

  let position = "CM";
  const posMatch =
    html.match(/class="[^"]*pcdisplay-pos[^"]*">([A-Za-z]{1,3})</i) ||
    html.match(/class="[^"]*player-pos[^"]*">([A-Za-z]{1,3})</i);
  if (posMatch) position = posMatch[1].toUpperCase();

  // 3. Face stats extraction
  const getStat = (tag: string, fallback: number = 70) => {
    const m =
      html.match(new RegExp(`class="[^"]*pcdisplay-${tag}[^"]*">(\\d+)<`, "i")) ||
      html.match(
        new RegExp(`(?:${tag.toUpperCase()})[\\s\\S]*?class="[^"]*stat-val[^"]*">(\\d+)<`, "i"),
      );
    return m ? parseInt(m[1], 10) : fallback;
  };

  const pac = getStat("pac", 75);
  const sho = getStat("sho", 70);
  const pas = getStat("pas", 70);
  const dri = getStat("dri", 75);
  const def = getStat("def", 70);
  const phy = getStat("phy", 70);

  // 4. In-game sub-stats
  const getSub = (key: string) => {
    const m =
      html.match(new RegExp(`(?:${key})[\\s\\S]*?class="[^"]*sub-stat-val[^"]*">(\\d+)<`, "i")) ||
      html.match(new RegExp(`data-stat="${key}"[^>]*>(\\d+)<`, "i"));
    return m ? parseInt(m[1], 10) : undefined;
  };

  // 5. PlayStyles & PlayStyles+
  const playstyles: string[] = [];
  const playstylesPlus: string[] = [];
  const psMatches = html.matchAll(/class="[^"]*playstyle[^"]*"[^>]*data-name="([^"]+)"/gi);
  for (const pm of psMatches) {
    const psName = pm[1].trim();
    if (psName.endsWith("+")) {
      playstylesPlus.push(psName);
    } else {
      playstyles.push(psName);
    }
  }

  // 6. Club, Nation, League
  const clubMatch =
    html.match(/alt="Club[^"]*"[^>]*>([^<]+)<\/a>/i) || html.match(/\/clubs\/\d+\/([^"']+)/i);
  const nationMatch =
    html.match(/alt="Nation[^"]*"[^>]*>([^<]+)<\/a>/i) || html.match(/\/nations\/\d+\/([^"']+)/i);
  const leagueMatch =
    html.match(/alt="League[^"]*"[^>]*>([^<]+)<\/a>/i) || html.match(/\/leagues\/\d+\/([^"']+)/i);

  const cleanSlug = (s?: string) =>
    s ? s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : undefined;

  // 7. Skills & Weak Foot
  const smMatch = html.match(/(\d)★\s*Skills?/i) || html.match(/Skills?.*?(\d)★/i);
  const wfMatch = html.match(/(\d)★\s*Weak/i) || html.match(/Weak.*?(\d)★/i);

  const prices = parseFutPlatformPrices(html);

  return {
    name,
    rating,
    overallRating: rating,
    position,
    club: cleanSlug(clubMatch?.[1]),
    nation: cleanSlug(nationMatch?.[1]),
    league: cleanSlug(leagueMatch?.[1]),
    pac,
    sho,
    pas,
    dri,
    def,
    phy,
    acceleration: getSub("acceleration") ?? pac,
    sprintSpeed: getSub("sprint-speed") ?? pac,
    finishing: getSub("finishing") ?? sho,
    shotPower: getSub("shot-power") ?? sho,
    composure: getSub("composure") ?? dri,
    reactions: getSub("reactions") ?? dri,
    agility: getSub("agility") ?? dri,
    balance: getSub("balance") ?? dri,
    interceptions: getSub("interceptions") ?? def,
    defensiveAwareness: getSub("def-awareness") ?? def,
    standingTackle: getSub("standing-tackle") ?? def,
    slidingTackle: getSub("sliding-tackle") ?? def,
    stamina: getSub("stamina") ?? phy,
    strength: getSub("strength") ?? phy,
    skillMoves: smMatch ? parseInt(smMatch[1], 10) : 3,
    weakFoot: wfMatch ? parseInt(wfMatch[1], 10) : 3,
    playstyles,
    playstylesPlus,
    price: prices.console > 0 ? String(prices.console) : undefined,
  };
}

/**
 * Scrapes a complete player profile from a FUTBin player page or raw HTML.
 */
export async function scrapeFutbinPlayer(
  urlOrHtml: string,
  profile: "http" = "http",
): Promise<FutPlayer | null> {
  let content = "";

  if (urlOrHtml.startsWith("http://") || urlOrHtml.startsWith("https://")) {
    content = (await fetchFutPage(urlOrHtml, profile === "http")).html ?? "";
  } else {
    content = urlOrHtml;
  }

  return extractFutbinPlayer(content);
}

export async function scrapeFutBinPrice(
  urlOrHtml: string,
  profile: "http" = "http",
  urlFallback?: string,
  platform?: FutPlatform,
): Promise<FutPrice> {
  let content = "";

  const isUrl = urlOrHtml.startsWith("http://") || urlOrHtml.startsWith("https://");
  const finalUrl = isUrl ? urlOrHtml : urlFallback || "unknown";

  if (isUrl) {
    content = (await fetchFutPage(urlOrHtml, profile === "http")).html ?? "";
  } else {
    content = urlOrHtml;
  }

  let priceVal = "";

  // 1. First attempt: Zero-copy high-performance Rust FFI DOM Tree query
  try {
    const { webParseHtml: parseHtml } = await import("@aphrody/bun/web");
    const tree = parseHtml(content);
    if (tree) {
      try {
        const priceNode = tree.querySelector(".price-val") || tree.querySelector("#flat-prices");
        if (priceNode) {
          priceVal = priceNode.replace(/<[^>]+>/g, "").trim();
        }
      } finally {
        tree.close();
      }
    }
  } catch {
    // Fallback to Web API / regex
  }

  // 2. Second attempt: Bun's native HTMLRewriter (Web API)
  if (!priceVal) {
    const rewriter = new HTMLRewriter().on(".price-val", {
      text(chunk) {
        priceVal += chunk.text;
      },
    });

    const response = new Response(content);
    await rewriter.transform(response).text();
    priceVal = priceVal.trim();
  }

  // 3. Third attempt: Heuristic RegExp fallback
  if (!priceVal) {
    const priceMatch = /id="flat-prices"[^>]*>[\s\S]*?(\d+[\d,]*\b)/i.exec(content);
    priceVal = priceMatch ? priceMatch[1].trim() : "";
  }

  const platformPrices = parseFutPlatformPrices(content);
  // Never invent a price: a failed scrape must surface as 0 / "", not as a
  // plausible-looking figure. parseFutPlatformPrices already flags any side it
  // estimated, and we propagate that flag instead of hiding it.
  const numPrice = parseInt(priceVal.replace(/[^0-9]/g, ""), 10) || platformPrices.console || 0;
  const consolePrice = platformPrices.console > 0 ? platformPrices.console : numPrice;
  const pcPrice = platformPrices.pc;
  const estimated = platformPrices.estimated;
  const pcPremiumPct = platformPrices.pcPremiumPercent;

  const chosenPrice =
    platform === "pc"
      ? pcPrice.toLocaleString("en-US")
      : priceVal || consolePrice.toLocaleString("en-US");

  return {
    url: finalUrl,
    price: chosenPrice,
    priceConsole: consolePrice,
    pricePc: pcPrice,
    platform: platform ?? "console",
    prices: {
      console: consolePrice,
      pc: pcPrice,
      pcPremiumPercent: pcPremiumPct,
      estimated,
    },
    lastUpdated: new Date().toISOString(),
  };
}
