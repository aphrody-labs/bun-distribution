// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { M3UiCache } from "../cache-db.ts";

describe("M3UiCache (native bun:sqlite)", () => {
  test("stores, retrieves and deletes cached entries with typed objects", () => {
    const cache = new M3UiCache(":memory:");

    // Theme palette cache test
    const palette = { primary: "#6750a4", secondary: "#625b71" };
    cache.set("theme", "seed:#6750a4", palette);

    const retrieved = cache.get<typeof palette>("theme", "seed:#6750a4");
    expect(retrieved).toEqual(palette);

    // Non-existent key
    expect(cache.get("theme", "missing")).toBeNull();

    // Stats
    const stats = cache.stats();
    expect(stats.totalEntries).toBe(1);
    expect(stats.namespaces["theme"]).toBe(1);

    // Delete
    expect(cache.delete("theme", "seed:#6750a4")).toBe(true);
    expect(cache.get("theme", "seed:#6750a4")).toBeNull();

    cache.close();
  });

  test("clears namespaces selectively or entirely", () => {
    const cache = new M3UiCache(":memory:");

    cache.set("icons", "home", "<svg>home</svg>");
    cache.set("icons", "settings", "<svg>settings</svg>");
    cache.set("tokens", "sys-color", ":root { --color: red; }");

    expect(cache.stats().totalEntries).toBe(3);

    // Clear icons only
    const clearedIcons = cache.clear("icons");
    expect(clearedIcons).toBe(2);
    expect(cache.get("icons", "home")).toBeNull();
    expect(cache.get("tokens", "sys-color")).not.toBeNull();

    // Clear all
    cache.clear();
    expect(cache.stats().totalEntries).toBe(0);

    cache.close();
  });
});
