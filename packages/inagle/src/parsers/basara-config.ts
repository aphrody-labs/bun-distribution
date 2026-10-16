/**
 * @file basara-config.ts
 * @description Parser for BASARA configuration
 */

import { loadJsonAsync } from "../core/async-loader.js";
import { findConfigFile, loadConfigData } from "../core/data-loader.js";
import { DATA_ROOT } from "../core/paths.js";

export interface BasaraBuildInfo {
  charaId: string;
  buildTypeIndices: number[];
}

export interface BasaraBuildType {
  type: number; // 0=GK? 1=FW?
  boardId: string;
}

function parseContent(content: any) {
  const buildInfos: BasaraBuildInfo[] = [];
  const buildTypes: BasaraBuildType[] = [];

  if (content.lists) {
    for (const list of content.lists) {
      if (list.name === "m_basaraBuildInfoList") {
        for (const val of list.values || []) {
          buildInfos.push({
            charaId: val.charaParamId,
            buildTypeIndices: val.typeInfo,
          });
        }
      } else if (list.name === "m_basaraBuildTypeList") {
        for (const val of list.values || []) {
          buildTypes.push({
            type: val.type,
            boardId: val.boardId,
          });
        }
      }
    }
  }
  return { buildInfos, buildTypes };
}

export function loadBasaraConfig(_dataPath: string = DATA_ROOT) {
  const filename = findConfigFile("character", "basara_chara_config");
  if (!filename) return null;

  try {
    const content = loadConfigData("character", filename);
    if (!content) return null;
    return parseContent(content);
  } catch (e) {
    console.error("Failed to load basara config sync", e);
    return null;
  }
}

export async function loadBasaraConfigAsync(dataPath: string = DATA_ROOT) {
  const filename = findConfigFile("character", "basara_chara_config");
  if (!filename) return null;

  const path = `${dataPath}/common/gamedata/character/${filename}`;
  const content = await loadJsonAsync<any>(path);

  return parseContent(content);
}
