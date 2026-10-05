import { expect, test } from "bun:test";
import {
  hasSymbol,
  readSymbolSvg,
  searchSymbols,
  symbolNames,
  symbolSvgPath,
} from "../src/index.ts";

test("symbolSvgPath follows the fork naming (default, fill, weight)", () => {
  expect(symbolSvgPath("home")).toEndWith("home/materialsymbolsoutlined/home_24px.svg");
  expect(symbolSvgPath("home", "rounded", 400, true)).toEndWith(
    "home/materialsymbolsrounded/home_fill1_24px.svg",
  );
  expect(symbolSvgPath("home", "sharp", 300)).toEndWith(
    "home/materialsymbolssharp/home_wght300_24px.svg",
  );
  expect(symbolSvgPath("home", "outlined", 300, true)).toEndWith(
    "home/materialsymbolsoutlined/home_wght300fill1_24px.svg",
  );
});

const materialised = symbolNames().length > 0;

test.skipIf(!materialised)(
  "materialised catalogue holds every style and fill for core symbols",
  () => {
    expect(symbolNames().length).toBeGreaterThan(4000);
    for (const style of ["outlined", "rounded", "sharp"] as const) {
      for (const filled of [false, true]) {
        expect(hasSymbol("home", style, 400, filled)).toBe(true);
      }
    }
    expect(readSymbolSvg("home")).toContain("<path");
  },
);

test("searchSymbols ignores blank queries", () => {
  expect(searchSymbols("   ")).toEqual([]);
});

test.skipIf(!materialised)("searchSymbols ranks exact matches first and honours the limit", () => {
  const hits = searchSymbols("home", 5);
  expect(hits[0]).toBe("home");
  expect(hits.length).toBeLessThanOrEqual(5);
  expect(searchSymbols("arrow back")).toContain("arrow_back");
});
