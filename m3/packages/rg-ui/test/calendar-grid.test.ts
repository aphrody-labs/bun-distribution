import { describe, expect, test } from "bun:test";

import {
  addMonths,
  dayLabel,
  firstDayOfWeek,
  inRange,
  isoWeekNumber,
  monthGrid,
  monthLabel,
  nextRange,
  weekdayLabels,
} from "../src/lib/calendar-grid";

describe("monthGrid", () => {
  test("octobre 2026 en semaines commençant le lundi", () => {
    const grid = monthGrid(new Date(2026, 9, 15), 1);
    expect(grid.length).toBe(5);
    expect(grid.every((week) => week.length === 7)).toBe(true);
    // 1er octobre 2026 : jeudi → 3 jours de septembre en tête.
    expect(grid[0]!.map((day) => day.date.getDate())).toEqual([28, 29, 30, 1, 2, 3, 4]);
    expect(grid[0]!.map((day) => day.outside)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(grid.at(-1)!.at(-1)!.date.getDate()).toBe(1);
  });

  test("la même semaine commençant le dimanche", () => {
    const grid = monthGrid(new Date(2026, 9, 1), 0);
    expect(grid[0]!.map((day) => day.date.getDate())).toEqual([27, 28, 29, 30, 1, 2, 3]);
  });

  test("février 2027 tient en quatre semaines pleines (lundi)", () => {
    const grid = monthGrid(new Date(2027, 1, 1), 1);
    expect(grid.length).toBe(4);
    expect(grid.flat().every((day) => !day.outside)).toBe(true);
  });

  test("cinq à six semaines selon le mois, jamais de semaine vide", () => {
    for (let month = 0; month < 12; month += 1) {
      const grid = monthGrid(new Date(2026, month, 1), 1);
      expect(grid.length).toBeGreaterThanOrEqual(4);
      expect(grid.length).toBeLessThanOrEqual(6);
      for (const week of grid) expect(week.some((day) => !day.outside)).toBe(true);
    }
  });
});

describe("libellés Intl", () => {
  test("jours en français commençant le lundi", () => {
    expect(weekdayLabels("fr-FR", 1, "short")).toEqual([
      "lun.",
      "mar.",
      "mer.",
      "jeu.",
      "ven.",
      "sam.",
      "dim.",
    ]);
  });

  test("mois et jour complets", () => {
    expect(monthLabel("fr-FR", new Date(2026, 9, 1))).toBe("octobre 2026");
    expect(dayLabel("fr-FR", new Date(2026, 9, 6))).toBe("mardi 6 octobre 2026");
  });

  test("début de semaine : France lundi, États-Unis dimanche", () => {
    expect(firstDayOfWeek("fr-FR")).toBe(1);
    expect(firstDayOfWeek("en-US")).toBe(0);
    expect(firstDayOfWeek("pas une locale")).toBe(1);
  });
});

describe("dates", () => {
  test("addMonths reste dans le mois cible", () => {
    expect(addMonths(new Date(2026, 0, 31), 1).getDate()).toBe(28);
    expect(addMonths(new Date(2026, 0, 15), -1).getMonth()).toBe(11);
  });

  test("semaine ISO", () => {
    expect(isoWeekNumber(new Date(2026, 0, 1))).toBe(1);
    expect(isoWeekNumber(new Date(2026, 9, 6))).toBe(41);
    expect(isoWeekNumber(new Date(2021, 0, 3))).toBe(53);
  });
});

describe("plages", () => {
  test("premier clic, second clic dans l'ordre ou inversé, troisième clic repart", () => {
    const a = new Date(2026, 9, 10);
    const b = new Date(2026, 9, 20);
    const first = nextRange(undefined, b);
    expect(first).toEqual({ from: b, to: undefined });
    expect(nextRange(first, a)).toEqual({ from: a, to: b });
    expect(nextRange(nextRange(first, a), b)).toEqual({ from: b, to: undefined });
  });

  test("inRange borne incluse", () => {
    const range = { from: new Date(2026, 9, 10), to: new Date(2026, 9, 12) };
    expect(inRange(new Date(2026, 9, 10, 23), range)).toBe(true);
    expect(inRange(new Date(2026, 9, 12), range)).toBe(true);
    expect(inRange(new Date(2026, 9, 13), range)).toBe(false);
    expect(inRange(new Date(2026, 9, 10), undefined)).toBe(false);
  });
});
