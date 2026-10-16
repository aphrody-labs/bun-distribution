import { describe, expect, test } from "bun:test";
import { categoryStats, getText, searchText } from "../src/game-text/index";

const hasPostgres = Boolean(
  process.env.DATABASE_URL ||
  process.env.ROSE_GRIFFON_DATABASE_URL ||
  process.env.RG_DATABASE_URL ||
  process.env.ACHILLEA_DATABASE_URL,
);

describe.skipIf(!hasPostgres)("game-text PostgreSQL", () => {
  test("recherche et statistiques utilisent la projection SQL", async () => {
    const stats = await categoryStats();
    expect(stats.length).toBeGreaterThan(0);
    const rows = await searchText("Mark", "fr", 5);
    expect(rows.length).toBeLessThanOrEqual(5);
    if (rows[0]) {
      const text = await getText(rows[0].hashId);
      expect(text?.hashId).toBe(rows[0].hashId);
    }
  });
});
