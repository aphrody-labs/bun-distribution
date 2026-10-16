import { findConfigFile, loadConfigData } from "../core/data-loader.js";

export interface ParsedCharaDetails {
  charaId: string;
  personalityType: number;
  firstPerson: string;
  secondPersonMale: string;
  secondPersonFemale: string;
}

/**
 * Parse character details config containing personality types and pronoun IDs
 */
export function parseCharaDetails(): Map<string, ParsedCharaDetails> {
  const map = new Map<string, ParsedCharaDetails>();
  const filename = findConfigFile("character", "chara_details_config");
  if (!filename) {
    return map;
  }

  try {
    const data = loadConfigData<{ lists?: { name: string; values?: any[] }[] }>("character", filename);
    if (!data) return map;
    const list = data.lists?.find((l: any) => l.name === "m_charaDetailsList");
    if (list?.values) {
      for (const val of list.values) {
        const charaId = val.chara_id.toUpperCase();
        map.set(charaId, {
          charaId,
          personalityType: val.personality_type,
          firstPerson: val.first_person.toUpperCase(),
          secondPersonMale: val.second_person_male.toUpperCase(),
          secondPersonFemale: val.second_person_female.toUpperCase(),
        });
      }
    }
  } catch (e) {
    console.error("[CharaDetails] Failed to parse chara_details_config", e);
  }

  return map;
}
