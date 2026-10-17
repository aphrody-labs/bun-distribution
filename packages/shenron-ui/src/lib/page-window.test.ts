import { describe, expect, test } from "bun:test";
import { pageWindow, pagerWindow, pagesVisibles } from "./page-window";

/**
 * Verbatim copy of `pagesVisibles` from apps/shenron/site/src/components/ui/Pagination.tsx
 * before the move (HEAD f602c132), kept as the parity oracle.
 */
function legacyPagesVisibles(page: number, total: number, fenetre = 1): Array<number | null> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set<number>([1, total, page]);
  for (let d = 1; d <= fenetre; d++) {
    if (page - d > 1) set.add(page - d);
    if (page + d < total) set.add(page + d);
  }
  // Garde une largeur constante quand on est à un bord (sinon la barre saute).
  if (page <= 3) [2, 3, 4].forEach(n => n < total && set.add(n));
  if (page >= total - 2) [total - 1, total - 2, total - 3].forEach(n => n > 1 && set.add(n));

  const tri = [...set].filter(n => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: Array<number | null> = [];
  let precedent = 0;
  for (const n of tri) {
    if (precedent && n - precedent > 1) out.push(null);
    out.push(n);
    precedent = n;
  }
  return out;
}

/**
 * Verbatim copy of `pagerWindow` from apps/shenron/site/src/components/kit/LinkPager.tsx
 * before the move (HEAD f602c132), kept as the parity oracle.
 */
function legacyPagerWindow(page: number, total: number, radius = 1): Array<number | null> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const keep = new Set<number>([1, total, page]);
  for (let d = 1; d <= radius; d++) {
    if (page - d > 1) keep.add(page - d);
    if (page + d < total) keep.add(page + d);
  }
  // Largeur constante près des bords : sinon la barre « saute » page après page.
  if (page <= 3) [2, 3, 4].forEach(n => n < total && keep.add(n));
  if (page >= total - 2) [total - 1, total - 2, total - 3].forEach(n => n > 1 && keep.add(n));

  const sorted = [...keep].filter(n => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: Array<number | null> = [];
  let previous = 0;
  for (const n of sorted) {
    if (previous && n - previous > 1) out.push(null);
    out.push(n);
    previous = n;
  }
  return out;
}

/** (current, total) pairs: every page of 0–40 pages, out-of-range pages and long lists. */
function parityTable(): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (let total = -1; total <= 40; total++) {
    for (let current = -1; current <= total + 2; current++) pairs.push([current, total]);
  }
  for (const total of [57, 100, 1307]) {
    for (const current of [1, 2, 3, 4, 5, total >> 1, total - 4, total - 3, total - 2, total - 1, total])
      pairs.push([current, total]);
  }
  pairs.push([2.5, 12], [Number.NaN, 12], [3, Number.NaN], [0, 0]);
  return pairs;
}

describe("pageWindow parity with both historical algorithms", () => {
  const pairs = parityTable();

  test("the table covers at least 50 (current, total) pairs", () => {
    expect(pairs.length).toBeGreaterThanOrEqual(50);
  });

  test("default window: identical to Pagination.pagesVisibles and LinkPager.pagerWindow", () => {
    const mismatches = pairs.filter(([current, total]) => {
      const actual = JSON.stringify(pageWindow(current, total));
      return (
        actual !== JSON.stringify(legacyPagesVisibles(current, total)) ||
        actual !== JSON.stringify(legacyPagerWindow(current, total))
      );
    });
    expect(mismatches).toEqual([]);
  });

  test("explicit radius 0–3: identical to both algorithms", () => {
    const mismatches: string[] = [];
    for (const radius of [0, 1, 2, 3]) {
      for (const [current, total] of pairs) {
        const actual = JSON.stringify(pageWindow(current, total, radius));
        if (
          actual !== JSON.stringify(legacyPagesVisibles(current, total, radius)) ||
          actual !== JSON.stringify(legacyPagerWindow(current, total, radius))
        )
          mismatches.push(`${current}/${total} r${radius}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  test("historical aliases are the same function", () => {
    expect(pagesVisibles).toBe(pageWindow);
    expect(pagerWindow).toBe(pageWindow);
  });
});

describe("pageWindow output", () => {
  test("lists every page up to seven pages", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pageWindow(1, 0)).toEqual([]);
  });

  test("keeps first, last, current and neighbours, with ellipses as null", () => {
    expect(pageWindow(6, 11)).toEqual([1, null, 5, 6, 7, null, 11]);
  });

  test("widens near the edges to keep a stable width", () => {
    expect(pageWindow(1, 11)).toEqual([1, 2, 3, 4, null, 11]);
    expect(pageWindow(11, 11)).toEqual([1, null, 8, 9, 10, 11]);
  });
});
