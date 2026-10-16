import { describe, expect, test } from "bun:test";

import { buildDailySignups } from "./signups";

describe("buildDailySignups", () => {
  test("accepte les dates PostgreSQL et les anciennes chaînes ISO", () => {
    const days = buildDailySignups(
      [
        { created_at: new Date("2026-09-24T23:30:00.000Z") },
        { created_at: "2026-09-25T01:15:00.000Z" },
        { created_at: null },
        { created_at: "date invalide" },
      ],
      new Date("2026-09-25T12:00:00.000Z"),
    );

    expect(days).toHaveLength(30);
    expect(days.find(day => day.date === "2026-09-24")?.count).toBe(1);
    expect(days.find(day => day.date === "2026-09-25")?.count).toBe(1);
  });
});
