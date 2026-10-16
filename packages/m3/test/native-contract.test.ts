// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { cssRequest, type M3CssConfig } from "../src/native.ts";
import { m3Tokens, SHEETS } from "../src/tokens.ts";

test("every supported sheet forwards the complete dynamic Rust request without baseline substitution", async () => {
  for (const sheet of SHEETS) {
    const expected = { sheet, seed: "#12ab34", variant: "fruit-salad", dark: true, contrast: 0.75 };
    const requests: M3CssConfig[] = [];
    const value = await m3Tokens({
      sheet,
      seed: "#12ab34",
      variant: "fruitSalad",
      dark: true,
      contrast: 0.75,
      css: input => {
        requests.push(input);
        return "native-provider-contract";
      },
    });
    expect(requests).toEqual([expected]);
    expect(value).toBe("native-provider-contract");
  }
  expect(cssRequest("scheme", { seed: "#00ff00", dark: false, contrast: 0 })).toEqual({
    sheet: "scheme",
    seed: "#00ff00",
    dark: false,
    contrast: 0,
  });
});

test("M3 selects the declared canonical binding owner, not an older registry implementation", async () => {
  const manifest = await Bun.file(new URL("../package.json", import.meta.url)).json();
  expect(manifest.dependencies["@aphrody/bun"]).toBe("workspace:*");
});
