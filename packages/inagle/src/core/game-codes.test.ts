import { describe, expect, it } from "bun:test";
import { ELEMENT_NAMES as BASARA_ELEMENT_NAMES } from "../basara/types.js";
import { ElementNames, RarityNames } from "./types.js";
import {
  CATEGORY_NAMES,
  ELEMENT_NAMES,
  GACHA_RARITY_NAMES,
  RANK_RARITY_NAMES,
} from "./game-codes.js";
import { rarityCodeToName, rarityToGrowthRank } from "../lib/rarity.js";
import {
  CATEGORY_NAMES as SKILL_CATEGORY_NAMES,
  ELEMENT_NAMES as SKILL_ELEMENT_NAMES,
} from "../skills/types.js";

describe("canonical game code tables", () => {
  it("shares one element table across public adapters", () => {
    expect(ElementNames).toBe(ELEMENT_NAMES);
    expect(SKILL_ELEMENT_NAMES).toBe(ELEMENT_NAMES);
    expect(BASARA_ELEMENT_NAMES).toBe(ELEMENT_NAMES);
    expect(ELEMENT_NAMES[2]?.en).toBe("Forest");
  });

  it("shares one category table with skills consumers", () => {
    expect(SKILL_CATEGORY_NAMES).toBe(CATEGORY_NAMES);
    expect(CATEGORY_NAMES[5]?.fr).toBe("Spécial");
  });

  it("keeps gacha and progression rarity spaces explicit", () => {
    expect(GACHA_RARITY_NAMES[20]).toBe("BASARA");
    expect(RarityNames).toBe(RANK_RARITY_NAMES);
    expect(rarityCodeToName(5)).toBe(GACHA_RARITY_NAMES[5]);
    expect(rarityCodeToName(999)).toBe("Rank999");
    expect(rarityToGrowthRank(20)).toBe(5);
  });
});
