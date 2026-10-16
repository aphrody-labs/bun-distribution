/**
 * @file quest-config.ts
 * @description Parser for quest_config files
 */

import type { ConfigNode } from "../core/config-parser.js";
import { findConfigFile, loadConfig, type Locale, toHex } from "../core/data-loader.js";
import { loadTextFile } from "./text-parser.js";

/** Quest type */
export enum QuestType {
  MAIN = 1,
  SUB = 2,
  DAILY = 3,
}

/** Parsed quest entry */
export interface ParsedQuest {
  /** Unique quest ID (hex) */
  questId: string;
  /** Title hash for text lookup */
  titleHash: string;
  /** Chapter/Phase number */
  phase: number;
  /** Quest type */
  type: number;
  /** Image name */
  image?: string;
  /** Localized titles */
  titles?: {
    en?: string;
    fr?: string;
    ja?: string;
  };
}

/**
 * Parse a quest node
 */
function parseQuestNode(node: ConfigNode): ParsedQuest | null {
  const vars = node.variables;
  if (vars.length < 4) return null;

  // [0] = quest ID hash
  const idVar = vars[0];
  if (idVar.type !== "Int") return null;
  const questId = toHex(Number.parseInt(idVar.value, 10));

  // [1] = phase/chapter
  const phaseVar = vars[1];
  const phase = phaseVar?.type === "Int" ? Number.parseInt(phaseVar.value, 10) : 0;

  // [2] = type
  const typeVar = vars[2];
  const type = typeVar?.type === "Int" ? Number.parseInt(typeVar.value, 10) : 0;

  // [3] = title hash
  const titleVar = vars[3];
  if (!titleVar || titleVar.type !== "Int") return null;
  const titleHash = toHex(Number.parseInt(titleVar.value, 10));

  // [16] = image
  let image: string | undefined;
  if (vars.length > 16) {
    const imgVar = vars[16];
    if (imgVar && imgVar.type === "String" && imgVar.value !== "") {
      image = imgVar.value;
    }
  }

  return {
    questId,
    titleHash,
    phase,
    type,
    image,
  };
}

/**
 * Find quest config file
 */
/**
 * Load and parse quest config
 */
export function loadQuestConfig(_dataPath: string): ParsedQuest[] {
  const configPath = findConfigFile("quest", "quest_config_");

  if (!configPath) {
    console.warn("[quest-config] No SQL/SQLite quest_config projection found.");
    return [];
  }

  const entries = loadConfig("quest", configPath).children as ConfigNode[];
  const quests: ParsedQuest[] = [];

  function traverse(node: ConfigNode) {
    if (node.name === "QUEST_DATA_CFG_LIST_BEG_0" && node.children) {
      for (const child of node.children) {
        if (child.name.startsWith("QUEST_DATA_CFG_")) {
          // Skip REF nodes
          if (child.name.includes("_REF_")) continue;

          const quest = parseQuestNode(child);
          if (quest) {
            quests.push(quest);
          }
        }
      }
    }

    if (node.children) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  }

  for (const entry of entries) {
    traverse(entry);
  }

  return quests;
}

/**
 * Build quest database
 */
export function buildQuestDatabase(
  dataPath: string,
  options?: {
    locales?: Locale[];
  },
): {
  quests: ParsedQuest[];
  byId: Map<string, ParsedQuest>;
} {
  const locales = options?.locales || (["en", "fr", "ja"] as Locale[]);
  const quests = loadQuestConfig(dataPath);

  // Load text maps for each locale
  const textMaps: Record<string, Map<string, string>> = {};
  for (const locale of locales) {
    const map = loadTextFile("quest_title", locale);
    if (map.size > 0) {
      textMaps[locale] = map;
    }
  }

  // Apply titles
  for (const quest of quests) {
    quest.titles = {};
    for (const locale of locales) {
      const map = textMaps[locale];
      if (map) {
        quest.titles[locale as "en" | "fr" | "ja"] = map.get(quest.titleHash);
      }
    }
  }

  // Build index
  const byId = new Map<string, ParsedQuest>();
  for (const quest of quests) {
    byId.set(quest.questId, quest);
  }

  return {
    quests,
    byId,
  };
}
