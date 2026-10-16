/**
 * @file mission-config.ts
 * @description Parser for mission_config files
 */

import type { ConfigNode } from "../core/config-parser.js";
import { findConfigFile, loadConfig, toHex } from "../core/data-loader.js";
import { loadTextFile } from "./text-parser.js";

export interface ParsedMission {
  missionId: string; // Hex
  code: string; // e.g. "msa999999"
  nameId: string;
  names: { en?: string; fr?: string; ja?: string };
}

export function buildMissionDatabase(_dataPath: string) {
  const configPath = findConfigFile("mission", "mission_config_");

  const missions: ParsedMission[] = [];
  const byId = new Map<string, ParsedMission>();

  if (!configPath) {
    console.warn("[mission-config] No SQL/SQLite mission_config projection found.");
    return { missions, byId };
  }

  // Text file is likely 'mission_text' or 'quest_text'
  const textEn = loadTextFile("mission", "en");
  const textFr = loadTextFile("mission", "fr");
  const textJa = loadTextFile("mission", "ja");

  try {
    const entries = loadConfig("mission", configPath).children as ConfigNode[];

    function traverse(node: ConfigNode) {
      // MISSION_CONFIG_INFO_0
      // Variables: [ID, Code, NameID, ...]
      if (node.name.startsWith("MISSION_CONFIG_INFO_")) {
        const vars = node.variables;
        if (vars.length >= 3) {
          const idInt = Number.parseInt(vars[0].value, 10) >>> 0;
          const code = vars[1].value;
          const nameIdInt = Number.parseInt(vars[2].value, 10) >>> 0;

          const idHex = toHex(idInt);
          const nameIdHex = toHex(nameIdInt);

          const mission: ParsedMission = {
            missionId: idHex,
            code,
            nameId: nameIdHex,
            names: {
              en: textEn.get(nameIdHex),
              fr: textFr.get(nameIdHex),
              ja: textJa.get(nameIdHex),
            },
          };

          missions.push(mission);
          byId.set(idHex, mission);
        }
      }
      if (node.children) node.children.forEach(traverse);
    }

    entries.forEach(traverse);
    console.log(`[MissionParser] Loaded ${missions.length} missions.`);
  } catch (e) {
    console.error("[mission-config] Build failed", e);
  }

  return { missions, byId };
}
