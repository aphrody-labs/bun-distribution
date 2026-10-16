// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { colorSchemeScript, themeCookie } from "../src/index";

function modeFor(cookie: string, cookieName?: string): string {
  const root = {
    classList: { remove() {}, toggle() {} },
    style: { colorScheme: "" },
  };
  runInNewContext(colorSchemeScript(cookieName), {
    document: { cookie, documentElement: root },
    window: { matchMedia: () => ({ matches: false }) },
  });
  return root.style.colorScheme;
}

describe("theme cookie identity", () => {
  test("only a complete theme value is accepted before paint", () => {
    expect(modeFor("m3-theme=darkened")).toBe("light");
    expect(modeFor("other=x;m3-theme=dark")).toBe("dark");
    expect(modeFor("m3-theme=dark%20")).toBe("light");
  });
  test("valid punctuation stays part of the cookie name", () => {
    expect(modeFor("app.theme=dark", "app.theme")).toBe("dark");
    expect(modeFor("apptheme=dark", "app.theme")).toBe("light");
    expect(themeCookie("dark", "app.theme")).toStartWith("app.theme=dark;");
  });
  test("cookie delimiters and script markup cannot become a cookie name", () => {
    for (const name of [
      "",
      "theme;path=/",
      "theme=dark",
      "</script>",
      "with space",
    ]) {
      expect(() => themeCookie("dark", name)).toThrow("HTTP cookie token");
      expect(() => colorSchemeScript(name)).toThrow("HTTP cookie token");
    }
  });
});
