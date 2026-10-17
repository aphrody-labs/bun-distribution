import { describe, expect, test } from "bun:test";
import {
  EMBER_SITE_THEME_DEFAULT,
  STYLES_PATH,
  TOKENS_PATH,
  expectedTokensModule,
  extractTokens,
  renderTokensModule,
} from "../scripts/generate-tokens";
import { tokens } from "../src/tokens";

describe("tokens.ts drift", () => {
  test("committed tokens.ts equals the module generated from styles.css", async () => {
    const committed = (await Bun.file(TOKENS_PATH).text()).replace(/\r\n/g, "\n");
    expect(committed).toBe((await expectedTokensModule()).replace(/\r\n/g, "\n"));
  });

  test("a changed styles.css without regeneration is detected", async () => {
    const css = await Bun.file(STYLES_PATH).text();
    const mutated = css.replace(/var\(--dbz-bg,\s*#[0-9a-fA-F]+\)/g, "var(--dbz-bg, #123456)");
    expect(mutated).not.toBe(css);
    const committed = (await Bun.file(TOKENS_PATH).text()).replace(/\r\n/g, "\n");
    const regenerated = renderTokensModule(extractTokens(mutated)).replace(/\r\n/g, "\n");
    expect(regenerated).not.toBe(committed);
    expect(extractTokens(mutated).color.bg).toBe("#123456");
  });
});

describe("ember (OWN-7)", () => {
  test("records both defaults, pinned to today's rendering", () => {
    expect(tokens.ember.siteThemeDefault).toBe(EMBER_SITE_THEME_DEFAULT);
    expect(tokens.ember.siteThemeDefault).toBe("#ff6b1a");
    expect(tokens.ember.css).toBe(tokens.color.ember);
    expect(tokens.ember.css).toBe("var(--color-dbz-orange)");
  });
});
