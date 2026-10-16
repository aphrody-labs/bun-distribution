/* eslint-disable no-console */
/**
 * Zukan scraper — fetch and parse character/skill lists from zukan.inazuma.jp
 *
 * Uses Cheerio 1.x:
 *   - `fromURL()` to fetch+parse in one call
 *   - `$.extract()` for declarative data extraction
 *
 * Run: npx tsx scripts/crawlers/zukan.ts
 */

import { writeFile } from "node:fs/promises";
import * as cheerio from "cheerio";

// --- Types ---

export interface ZukanCharacter {
  id: string;
  name: string;
  nickname?: string;
  image?: string;
  detailUrl?: string;
  rarity?: string;
  position?: string;
  element?: string;
  gender?: string;
}

export interface ZukanSkill {
  name: string;
  type?: string;
  videoUrl?: string;
}

type ZukanContentType = "character_list" | "skill_list" | "item_list" | "unknown";

export interface ZukanResult {
  type: ZukanContentType;
  url: string;
  data: ZukanCharacter[] | ZukanSkill[];
  count: number;
}

// --- Config ---

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function loadURL(url: string): Promise<cheerio.CheerioAPI> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return cheerio.load(await res.text());
}

// --- Extraction ---

function extractCharacters($: cheerio.CheerioAPI): ZukanCharacter[] {
  const raw = $.extract({
    characters: [
      {
        selector: "tbody:has(input.my-team-checkbox)",
        value: {
          id: {
            selector: "input.my-team-checkbox",
            value: "data-chara-id",
          },
          name: {
            selector: "input.my-team-checkbox",
            value: "data-chara-name",
          },
          nickname: {
            selector: "input.my-team-checkbox",
            value: "data-nickname",
          },
          detailUrl: {
            selector: "a[href*='chara_param']",
            value: "href",
          },
          image: {
            selector: "img[src*='cloudfront']",
            value: "src",
          },
          gender: "td:nth-child(6)",
          element: "td:nth-child(7)",
          position: "td:nth-child(8)",
          rarity: "td:nth-child(11)",
        },
      },
    ],
  });

  return raw.characters
    .filter((c) => c.id && c.name)
    .map((c) => ({
      id: c.id!,
      name: c.name!,
      nickname: c.nickname || undefined,
      detailUrl: c.detailUrl
        ? c.detailUrl.startsWith("http")
          ? c.detailUrl
          : `https://zukan.inazuma.jp${c.detailUrl}`
        : undefined,
      image: c.image ? (c.image.startsWith("//") ? `https:${c.image}` : c.image) : undefined,
      gender: c.gender || undefined,
      element: c.element || undefined,
      position: c.position || undefined,
      rarity: c.rarity || undefined,
    }));
}

function extractSkills($: cheerio.CheerioAPI): ZukanSkill[] {
  const raw = $.extract({
    skills: [
      {
        selector: "ul.skillListBox > li",
        value: {
          name: ".nameBox .name",
          videoUrl: {
            selector: "a[data-movie-url]",
            value: "data-movie-url",
          },
        },
      },
    ],
  });

  // Types need manual extraction (multiple <a> per skill)
  const typesByIndex: string[][] = [];
  $("ul.skillListBox > li").each((i, li) => {
    const types: string[] = [];
    $(li)
      .find(".btnBox a")
      .each((_, a) => {
        types.push($(a).text().trim());
      });
    typesByIndex[i] = types;
  });

  return raw.skills
    .filter((s) => Boolean(s.name))
    .map((s, i) => ({
      name: s.name!,
      type: typesByIndex[i]?.join(", ") || undefined,
      videoUrl: s.videoUrl?.endsWith(".wmv")
        ? s.videoUrl.replace(".wmv", ".webm")
        : s.videoUrl || undefined,
    }));
}

// --- Public API ---

export async function scrapeZukanPage(url: string): Promise<ZukanResult | null> {
  console.log(`[Zukan] Scraping: ${url}`);

  try {
    const $ = await loadURL(url);

    if ($("input.my-team-checkbox").length > 0) {
      const data = extractCharacters($);
      return { type: "character_list", url, data, count: data.length };
    }

    if ($("ul.skillListBox").length > 0) {
      const data = extractSkills($);
      return { type: "skill_list", url, data, count: data.length };
    }

    if ($("ul.itemListBox").length > 0 || $(".item-list").length > 0) {
      return { type: "item_list", url, data: [], count: 0 };
    }

    return { type: "unknown", url, data: [], count: 0 };
  } catch (error) {
    console.error("[Zukan] Error:", error);
    return null;
  }
}

// --- Main ---

async function main() {
  const urls = [
    "https://zukan.inazuma.jp/en/chara_list/?q=hN2Jmo2MlpCRoJmWk4uajd3FpN24sMzdooI=&per_page=200",
    "https://zukan.inazuma.jp/en/chara_list/?page=2&per_page=200&q=hN2Jmo2MlpCRoJmWk4uajd3FpN0cfV0cfFMcfUbdooI%3D",
  ];

  const allData: (ZukanCharacter | ZukanSkill)[] = [];

  for (const url of urls) {
    const result = await scrapeZukanPage(url);
    if (result && result.count > 0) {
      console.log(`  ${result.count} ${result.type} items`);
      allData.push(...result.data);
    } else {
      console.log(`  No data or error for ${url}`);
    }
  }

  console.log(`\nTotal scraped: ${allData.length}`);
  await writeFile("zukan_mirror.json", JSON.stringify(allData, null, 2));
  console.log("Saved to zukan_mirror.json");
}

const isDirectRun =
  import.meta.url.startsWith("file:") &&
  process.argv[1] &&
  (process.argv[1] === import.meta.url.replace("file://", "") ||
    process.argv[1].endsWith("zukan.ts"));

if (isDirectRun) main();
