/**
 * @file help-config.ts
 * @description Parser for help_list_config files (Tutorials)
 */

import type { ConfigNode } from "../core/config-parser.js";
import { findConfigFile, loadConfig, toHex } from "../core/data-loader.js";
import { loadTextList } from "./text-parser.js";

export interface ParsedHelp {
  helpId: string; // Hex
  names: { en?: string; fr?: string; ja?: string };
  descriptions?: { en?: string; fr?: string; ja?: string };
  category?: string;
  image?: string;
}

export function buildHelpDatabase(_dataPath: string) {
  const configPath = findConfigFile("help", "help_list_config_");

  const helpItems: ParsedHelp[] = [];

  if (!configPath) {
    console.warn("[help-config] No SQL/SQLite help_list_config projection found.");
    return { helpItems };
  }

  // Load Texts as Lists (Index based)
  const listEn = loadTextList("help", "en");
  const listFr = loadTextList("help", "fr");
  const listJa = loadTextList("help", "ja");

  try {
    const entries = loadConfig("help", configPath).children as ConfigNode[];

    function traverse(node: ConfigNode) {
      // HELP_LIST_IMAGE matches are better for finding the "Slide" type tutorials
      // HELP_LIST_INFO seems to be categories/structure

      // Try HELP_LIST_IMAGE first
      if (node.name.startsWith("HELP_LIST_IMAGE_") && !node.name.includes("_LIST_")) {
        const vars = node.variables;

        let nameIdx = -1;
        let descIdx = -1;
        let image = "";
        let idHex = "";

        // Look for Image String
        const strVar = vars.find(v => v.type === "String");
        if (strVar) image = strVar.value;

        // Heuristic: Find small integers that are valid text indices
        const indices: number[] = [];
        for (const v of vars) {
          if (v.type === "Int") {
            const val = Number.parseInt(v.value, 10);
            if (val >= 0 && val < listFr.length && listFr[val]) {
              indices.push(val);
            }
          }
        }

        if (indices.length > 0) {
          // Usually Title is first valid text, Desc is second
          nameIdx = indices[0];
          if (indices.length > 1) descIdx = indices[1];

          idHex = toHex(nameIdx); // Use name index as ID

          const help: ParsedHelp = {
            helpId: idHex,
            names: {
              en: listEn[nameIdx],
              fr: listFr[nameIdx],
              ja: listJa[nameIdx],
            },
            image,
          };

          if (descIdx >= 0) {
            help.descriptions = {
              en: listEn[descIdx],
              fr: listFr[descIdx],
              ja: listJa[descIdx],
            };
          }

          helpItems.push(help);
        }
      }
      if (node.children) node.children.forEach(traverse);
    }

    entries.forEach(traverse);

    console.log(`[HelpParser] Loaded ${helpItems.length} help items.`);
  } catch (e) {
    console.error("[help-config] Build failed", e);
  }

  return { helpItems };
}
