// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { publicAssetUrl, publicPetAtlas, publicPetSymbol, publicMaterialSymbolsIndex } from "./public-assets";
const base = "https://assets.aphrody.app";
test("public assets use explicit object paths while local atlas remains unchanged", () => {
  expect(publicPetAtlas("local.webp")).toBe("local.webp");
  expect(publicPetAtlas("local.webp", base)).toBe(base + "/pet/spritesheet.webp");
  expect(publicPetSymbol("svg/sharp/wght700/pet_idle.svg", base)).toBe(
    base + "/pet/symbols/svg/sharp/wght700/pet_idle.svg",
  );
  expect(publicMaterialSymbolsIndex(base)).toBe(base + "/m3/symbols/material-symbols-index.json");
});
test("public assets refuse credentials traversal and scheme injection", () => {
  for (const path of [
    "../secret",
    "/absolute",
    "https://other.example/image",
    "image?token=secret",
    "%2e%2e/image",
    "a\\image",
  ])
    expect(() => publicAssetUrl(path, base)).toThrow();
  for (const origin of ["http://example.com", "https://user:secret@example.com", "https://example.com/?secret"])
    expect(() => publicPetAtlas("", origin)).toThrow();
});
