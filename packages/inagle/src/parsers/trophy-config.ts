/**
 * @file trophy-config.ts
 * @description Parser for trophy_config files (Achievements)
 */

import type { ConfigNode } from "../core/config-parser.js";
import { findConfigFile, loadConfig, toHex } from "../core/data-loader.js";
import { loadTextFile } from "./text-parser.js";

export interface ParsedTrophy {
  trophyId: string;
  code: string;
  names: { en?: string; fr?: string; ja?: string };
  descriptions: { en?: string; fr?: string; ja?: string };
}

export function buildTrophyDatabase(_dataPath: string) {
  const configPath = findConfigFile("trophy", "trophy_config_");

  const trophies: ParsedTrophy[] = [];

  if (!configPath) {
    console.warn("[trophy-config] No SQL/SQLite trophy_config projection found.");
    return { trophies };
  }

  // Texts
  const textEn = loadTextFile("trophy", "en");
  const textFr = loadTextFile("trophy", "fr");
  const textJa = loadTextFile("trophy", "ja");

  const validHashes = new Set(textFr.keys());

  try {
    const entries = loadConfig("trophy", configPath).children as ConfigNode[];

    function traverse(node: ConfigNode) {
      // TROPHY_INFO_0
      if (node.name.startsWith("TROPHY_INFO_") && !node.name.includes("_LIST_") && !node.name.includes("_REF_")) {
        const vars = node.variables;

        let idHex = "";
        let code = "";
        let nameHash = "";
        let descHash = "";

        if (vars.length > 0 && vars[0].type === "Int") {
          idHex = toHex(Number.parseInt(vars[0].value, 10));
        }

        // Find Code
        const strVar = vars.find(v => v.type === "String");
        if (strVar) code = strVar.value;

        // Find Hashes
        const matches: string[] = [];
        for (const v of vars) {
          if (v.type === "Int") {
            const hex = toHex(Number.parseInt(v.value, 10));
            if (validHashes.has(hex)) matches.push(hex);
          }
        }

        if (matches.length > 0) {
          nameHash = matches[0];
          if (matches.length > 1) descHash = matches[1];

          const trophy: ParsedTrophy = {
            trophyId: code || nameHash || idHex,
            code,
            names: {
              en: textEn.get(nameHash),
              fr: textFr.get(nameHash),
              ja: textJa.get(nameHash),
            },
            descriptions: {
              en: textEn.get(descHash),
              fr: textFr.get(descHash),
              ja: textJa.get(descHash),
            },
          };

          trophies.push(trophy);
        }
      }
      if (node.children) node.children.forEach(traverse);
    }

    entries.forEach(traverse);
    console.log(`[TrophyParser] Loaded ${trophies.length} trophies.`);
  } catch (e) {
    console.error("[trophy-config] Build failed", e);
  }

  return { trophies };
}
