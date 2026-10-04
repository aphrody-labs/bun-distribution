// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import {
  GEMINI_BRAND_COLORS,
  GEMINI_BRAND_GRADIENTS,
  GEMINI_BRAND_SHAPES,
  getGeminiBrandCss,
} from "../src/index.js";

describe("@aphrody/m3-theme brand tokens", () => {
  it("exposes canonical Gemini brand colors matching Rust definitions", () => {
    expect(GEMINI_BRAND_COLORS.blue).toBe("#3186FF");
    expect(GEMINI_BRAND_COLORS.green).toBe("#0EBC5F");
    expect(GEMINI_BRAND_COLORS.yellow).toBe("#FFCC00");
    expect(GEMINI_BRAND_COLORS.red).toBe("#FF4641");
    expect(GEMINI_BRAND_COLORS.purple).toBe("#9B72CB");
    expect(GEMINI_BRAND_COLORS.pink).toBe("#D96570");
  });

  it("exposes canonical brand gradients", () => {
    expect(GEMINI_BRAND_GRADIENTS.spectrumShift).toContain("linear-gradient");
    expect(GEMINI_BRAND_GRADIENTS.warmTone).toContain("linear-gradient");
    expect(GEMINI_BRAND_GRADIENTS.sparkle).toContain("radial-gradient");
  });

  it("exposes standard brand corner radii", () => {
    expect(GEMINI_BRAND_SHAPES.promptBar).toBe("32px");
    expect(GEMINI_BRAND_SHAPES.promptBarInitial).toBe("40px");
    expect(GEMINI_BRAND_SHAPES.promptBarDocked).toBe("24px 24px 0 0");
    expect(GEMINI_BRAND_SHAPES.chip).toBe("16px");
    expect(GEMINI_BRAND_SHAPES.message).toBe("24px");
  });

  it("generates runtime CSS variables declaring all brand tokens", () => {
    const css = getGeminiBrandCss();
    expect(css).toContain("--gemini-brand-blue: #3186FF;");
    expect(css).toContain("--gemini-spectrum-shift:");
    expect(css).toContain("--gemini-corner-prompt-bar: 32px;");
  });
});
