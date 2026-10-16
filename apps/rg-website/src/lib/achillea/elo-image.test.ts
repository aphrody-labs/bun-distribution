/**
 * Test unitaire de `rankImagePath()` (mapping palier → slug d'image, FR/EN).
 * Porté d'achillea-web vers apps/website.
 *
 * Run : bun test apps/website/src/lib/achillea/elo-image.test.ts
 */
import { describe, expect, test } from "bun:test";
import { rankImagePath } from "./index";

describe("rankImagePath (website)", () => {
  test("mappe les paliers FR vers leur slug image FR (ASCII, sans accent)", () => {
    expect(rankImagePath("Fer")).toBe("ranks/fer.webp");
    expect(rankImagePath("Diamant")).toBe("ranks/diamant.webp");
    expect(rankImagePath("Émeraude")).toBe("ranks/emeraude.webp");
    expect(rankImagePath("Rubis")).toBe("ranks/rubis.webp");
    expect(rankImagePath("Légendaire")).toBe("ranks/legendaire.webp");
  });

  test("fallback Fer sur clé absente ou inconnue", () => {
    expect(rankImagePath(null as any)).toBe("ranks/fer.webp");
    expect(rankImagePath(undefined as any)).toBe("ranks/fer.webp");
    expect(rankImagePath("palier-inexistant" as any)).toBe("ranks/fer.webp");
  });
});
