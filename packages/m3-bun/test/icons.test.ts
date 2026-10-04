// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { iconFile, iconsRoot, parseIconSpecifier, readIcon } from "../src/icons.ts";

describe("parseIconSpecifier", () => {
  test("name, style and variant query", () => {
    expect(parseIconSpecifier("home")).toEqual({ name: "home", style: "outlined", fill: false, weight: 400 });
    expect(parseIconSpecifier("rounded/arrow_back?fill=1&wght=300")).toEqual({ name: "arrow_back", style: "rounded", fill: true, weight: 300 });
  });
  test("bad names, styles and weights are errors", () => {
    expect(() => parseIconSpecifier("Home")).toThrow(/invalid icon name/);
    expect(() => parseIconSpecifier("../x")).toThrow(/invalid icon name|style must be/);
    expect(() => parseIconSpecifier("fancy/home")).toThrow(/style must be one of/);
    expect(() => parseIconSpecifier("home?wght=450")).toThrow(/wght must be/);
  });
  test("file names follow the catalogue spelling", () => {
    expect(iconFile({ name: "home", style: "outlined", fill: false, weight: 400 })).toBe("home_24px.svg");
    expect(iconFile({ name: "home", style: "outlined", fill: true, weight: 400 })).toBe("home_fill1_24px.svg");
    expect(iconFile({ name: "home", style: "outlined", fill: false, weight: 300 })).toBe("home_wght300_24px.svg");
    expect(iconFile({ name: "home", style: "outlined", fill: true, weight: 300 })).toBe("home_wght300fill1_24px.svg");
  });
});

describe("readIcon", () => {
  const root = iconsRoot() ?? null;
  test.skipIf(!root)("reads real SVG markup from the forked catalogue", () => {
    const svg = readIcon({ name: "home", style: "outlined", fill: false, weight: 400 }, root);
    expect(svg).toStartWith("<svg");
    expect(svg).toContain('viewBox="0 -960 960 960"');
    expect(readIcon({ name: "home", style: "rounded", fill: true, weight: 400 }, root)).not.toBe(svg);
    expect(() => readIcon({ name: "no_such_symbol_xyz", style: "outlined", fill: false, weight: 400 }, root)).toThrow(/no icon outlined\/no_such_symbol_xyz_24px\.svg/);
  });
  test("without a catalogue the error says how to get one", () => {
    expect(() => readIcon({ name: "home", style: "outlined", fill: false, weight: 400 }, null)).toThrow(/forks\.ts sparse material-design-icons/);
  });
  test("M3_ICONS_ROOT wins", () => {
    const saved = Bun.env.M3_ICONS_ROOT;
    Bun.env.M3_ICONS_ROOT = "/somewhere/else";
    try {
      expect(iconsRoot()).toBe("/somewhere/else");
    } finally {
      if (saved === undefined) delete Bun.env.M3_ICONS_ROOT;
      else Bun.env.M3_ICONS_ROOT = saved;
    }
  });
});
