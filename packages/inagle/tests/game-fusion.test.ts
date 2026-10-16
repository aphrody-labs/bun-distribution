import { describe, expect, test } from "bun:test";
import {
  FORMATIONS,
  LEGACY_FORMATIONS,
  decodeTeamCode,
  encodeTeamCode,
  formatDescription,
  GAIJI,
  translateEffect,
  isFemaleGender,
  TEAM_EMBLEM_MAP,
  game,
  cpk,
  text,
  gameText,
} from "../src/index.js";

describe("Inagle Game & Text Consolidation", () => {
  test("exports canonical formations", () => {
    expect(FORMATIONS).toBeDefined();
    expect(Array.isArray(FORMATIONS)).toBe(true);
    expect(FORMATIONS.length).toBe(8);

    expect(LEGACY_FORMATIONS).toBeDefined();
    expect(LEGACY_FORMATIONS.length).toBe(8);

    const f442 = FORMATIONS.find(f => f.name === "4-4-2" || f.id.includes("442"));
    expect(f442).toBeDefined();
    expect(f442?.positions.length).toBe(11);
  });

  test("encodes and decodes team codes byte-accurately", () => {
    const slots = [
      { slot: "field-0", charaId: "c01000010" },
      { slot: "field-1", charaId: "c01000020" },
    ];
    const encoded = encodeTeamCode("form_442", slots);
    expect(encoded).toBeString();
    expect(encoded.length).toBeGreaterThan(10);

    const decoded = decodeTeamCode(encoded);
    expect(decoded.formationId).toBe("form_442");
    expect(decoded.slots).toHaveLength(2);
    expect(decoded.slots[0]).toEqual({ slot: "field-0", charaId: "c01000010" });
    expect(decoded.slots[1]).toEqual({ slot: "field-1", charaId: "c01000020" });
  });

  test("translates effects and formats descriptions", () => {
    const translated = translateEffect("Shot AT +10%");
    expect(translated).toBe("Tir ATT +10%");

    const untranslated = translateEffect("Unknown Effect XYZ");
    expect(untranslated).toBe("Unknown Effect XYZ");

    const desc = formatDescription("Inflicts <color=#ff0000>burn</color> on hit.");
    expect(desc).toBeDefined();
  });

  test("exposes Gaiji glyphs for UI font rendering", () => {
    expect(GAIJI).toBeDefined();
    expect(GAIJI.plus1).toBeDefined();
    expect(GAIJI.plus1.label).toBe("+1");
    expect(GAIJI.plus1.name).toBe("gaiji_wlv101");
  });

  test("checks gender rules and emblem mappings", () => {
    expect(isFemaleGender("Female")).toBe(true);
    expect(isFemaleGender("Male")).toBe(false);

    expect(TEAM_EMBLEM_MAP).toBeDefined();
    expect(typeof TEAM_EMBLEM_MAP).toBe("object");
  });

  test("exposes sub-namespaces game, cpk, text, gameText", () => {
    expect(game).toBeDefined();
    expect(game.FORMATIONS).toBeDefined();
    expect(cpk).toBeDefined();
    expect(typeof cpk.listDir).toBe("function");
    expect(text).toBeDefined();
    expect(typeof text.formatDescription).toBe("function");
    expect(gameText).toBeDefined();
    expect(typeof gameText.getText).toBe("function");
  });
});
