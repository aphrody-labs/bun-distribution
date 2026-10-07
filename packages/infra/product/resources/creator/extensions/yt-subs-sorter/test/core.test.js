// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";

const core = require("../src/core.js");

const UC = "UCsBjURrPoezykLs9EqgamOA"; // 24 chars, shape of a real channel id
const UC2 = "UCuAXFkgsw1L7xaCfnd5JJOw";

function withGroups(...names) {
  let state = core.emptyState();
  names.forEach((name, i) => {
    state = core.addGroup(state, name, undefined, `g${i + 1}`).state;
  });
  return state;
}

describe("parseChannelRef", () => {
  test("handles are lower-cased and decoded", () => {
    expect(core.parseChannelRef("/@Fireship")).toEqual({ kind: "handle", key: "@fireship" });
    expect(core.parseChannelRef("/@Fireship/videos?view=0")).toEqual({
      kind: "handle",
      key: "@fireship",
    });
    expect(core.parseChannelRef("/@%E3%83%92%E3%82%AB%E3%82%AD%E3%83%B3")).toEqual({
      kind: "handle",
      key: "@ヒカキン",
    });
  });

  test("absolute youtube URLs", () => {
    expect(core.parseChannelRef("https://www.youtube.com/@RickAstleyYT")?.key).toBe(
      "@rickastleyyt",
    );
    expect(core.parseChannelRef("https://m.youtube.com/@x")?.key).toBe("@x");
    expect(core.parseChannelRef(`http://youtube.com/channel/${UC}`)).toEqual({
      kind: "id",
      key: UC,
    });
  });

  test("channel id, /c/ and /user/", () => {
    expect(core.parseChannelRef(`/channel/${UC}`)).toEqual({ kind: "id", key: UC });
    expect(core.parseChannelRef("/c/SomeName")).toEqual({ kind: "c", key: "c:somename" });
    expect(core.parseChannelRef("/user/OldName/featured")).toEqual({
      kind: "user",
      key: "u:oldname",
    });
  });

  test("rejects anything else", () => {
    for (const bad of [
      "",
      null,
      undefined,
      "/watch?v=abc",
      "/channel/notanid",
      `/channel/${UC}x`,
      "/@",
      "https://evil.example/@fireship",
      "https://www.youtube.com.evil.example/@fireship",
      "javascript:alert(1)",
      "//www.youtube.com/@x",
      "/feed/subscriptions",
    ]) {
      expect(core.parseChannelRef(bad)).toBeNull();
    }
  });
});

describe("routeOf", () => {
  test("maps pathnames to page kinds", () => {
    expect(core.routeOf("/feed/subscriptions")).toBe("feed");
    expect(core.routeOf("/feed/subscriptions/")).toBe("feed");
    expect(core.routeOf("/feed/channels")).toBe("channels");
    expect(core.routeOf("/watch")).toBe("watch");
    expect(core.routeOf("/@Fireship")).toBe("channel");
    expect(core.routeOf("/@Fireship/shorts")).toBe("channel");
    expect(core.routeOf(`/channel/${UC}`)).toBe("channel");
    expect(core.routeOf("/")).toBeNull();
    expect(core.routeOf("/results")).toBeNull();
    expect(core.routeOf("/shorts/abc")).toBeNull();
    expect(core.routeOf(undefined)).toBeNull();
  });
});

describe("keys and aliases", () => {
  test("pairForAlias needs exactly one handle and one id", () => {
    expect(core.pairForAlias(["@a", UC])).toEqual({ handle: "@a", id: UC });
    expect(core.pairForAlias(["@a", "@b", UC])).toBeNull(); // collaboration
    expect(core.pairForAlias(["@a", UC, UC2])).toBeNull();
    expect(core.pairForAlias(["@a"])).toBeNull();
    expect(core.pairForAlias(["@a", UC, "c:legacy"])).toBeNull();
    expect(core.pairForAlias(null)).toBeNull();
  });

  test("bestKey prefers handle, then id, then legacy", () => {
    expect(core.bestKey([UC, "@a"])).toBe("@a");
    expect(core.bestKey(["u:old", UC])).toBe(UC);
    expect(core.bestKey(["u:old", "c:new"])).toBe("c:new");
    expect(core.bestKey(["nope"])).toBeNull();
  });

  test("learnAlias moves the record to the best key and re-points older aliases", () => {
    let s = withGroups("FGC", "Dessin");
    s = core.toggleChannelGroup(s, UC, "Chaine", "g1");
    s = core.toggleChannelGroup(s, "c:old", "Chaine", "g2");
    s = core.learnAlias(s, "c:old", UC);
    expect(s.aliases["c:old"]).toBe(UC);
    s = core.learnAlias(s, "@chaine", UC);
    expect(s.aliases[UC]).toBe("@chaine");
    expect(s.aliases["c:old"]).toBe("@chaine");
    expect(Object.keys(s.channels)).toEqual(["@chaine"]);
    expect(s.channels["@chaine"].g.toSorted()).toEqual(["g1", "g2"]);
    expect(core.groupsOf(s, UC).toSorted()).toEqual(["g1", "g2"]);
    expect(core.learnAlias(s, UC, "@chaine")).toBe(s); // already known: same object
  });
});

describe("normalizeState", () => {
  test("drops invalid groups, channels and aliases", () => {
    const { state, warnings } = core.normalizeState({
      groups: [
        { id: "g1", name: "  FGC  ", color: "#ABCDEF" },
        { id: "g1", name: "Doublon id" },
        { id: "g2", name: "fgc" },
        { id: "bad id!", name: "x" },
        { id: "g3", name: "" },
        { id: "g4", name: "Musique", color: "red" },
        null,
      ],
      channels: {
        "@ok": { n: "Ok", g: ["g1", "gX", "g1"] },
        "@orphan": { n: "x", g: ["gX"] },
        "not a key": { g: ["g1"] },
        [UC]: { n: "Id", g: "g1" },
      },
      aliases: { "c:a": "@a", "@a": "@a", bad: "@a", [UC]: "bad" },
      settings: {
        feedFilter: "gX",
        listFilter: "g4",
        hideShorts: "yes",
        watchedThreshold: 500,
        sort: "weird",
      },
    });
    expect(state.groups.map((g) => [g.id, g.name])).toEqual([
      ["g1", "FGC"],
      ["g4", "Musique"],
    ]);
    expect(state.groups[0].color).toBe("#abcdef");
    expect(state.groups[1].color).toMatch(/^#[0-9a-f]{6}$/);
    expect(state.channels).toEqual({ "@ok": { n: "Ok", g: ["g1"] } });
    expect(state.aliases).toEqual({ "c:a": "@a" });
    expect(state.settings).toEqual({
      ...core.DEFAULT_SETTINGS,
      listFilter: "g4",
      watchedThreshold: 100,
    });
    expect(warnings.length).toBeGreaterThan(0);
    expect(Object.getPrototypeOf(state.channels)).toBe(Object.prototype);
  });

  test("non-object input gives an empty state", () => {
    expect(core.normalizeState(undefined).state).toEqual(core.emptyState());
    expect(core.normalizeState("x").state).toEqual(core.emptyState());
  });
});

describe("groups", () => {
  test("addGroup validates name, duplicates and colour", () => {
    const s = core.emptyState();
    expect(core.addGroup(s, "   ").error).toBe("name-empty");
    const a = core.addGroup(s, "  Combat / FGC ", "#00ff00", "gfgc");
    expect(a.group).toEqual({ id: "gfgc", name: "Combat / FGC", color: "#00ff00" });
    expect(core.addGroup(a.state, "combat / fgc").error).toBe("name-duplicate");
    const b = core.addGroup(a.state, "Dessin", "not-a-colour");
    expect(b.group.color).toBe(core.PALETTE[1]);
    expect(core.addGroup(b.state, "X", undefined, "gfgc").group.id).not.toBe("gfgc");
  });

  test("updateGroup renames and recolours with the same checks", () => {
    const s = withGroups("A", "B");
    expect(core.updateGroup(s, "g1", { name: "b" }).error).toBe("name-duplicate");
    expect(core.updateGroup(s, "g1", { name: " " }).error).toBe("name-empty");
    expect(core.updateGroup(s, "g1", { color: "zzz" }).error).toBe("color-invalid");
    expect(core.updateGroup(s, "nope", {}).error).toBe("group-unknown");
    const u = core.updateGroup(s, "g1", { name: "Alpha", color: "#112233" });
    expect(u.state.groups[0]).toEqual({ id: "g1", name: "Alpha", color: "#112233" });
    expect(s.groups[0].name).toBe("A"); // input not mutated
  });

  test("deleteGroup cascades to channels and filters", () => {
    let s = withGroups("A", "B");
    s = core.toggleChannelGroup(s, "@x", "X", "g1");
    s = core.toggleChannelGroup(s, "@x", "X", "g2");
    s = core.toggleChannelGroup(s, "@y", "Y", "g1");
    s = { ...s, settings: { ...s.settings, feedFilter: "g1", listFilter: "g2" } };
    const d = core.deleteGroup(s, "g1");
    expect(d.groups.map((g) => g.id)).toEqual(["g2"]);
    expect(d.channels).toEqual({ "@x": { n: "X", g: ["g2"] } });
    expect(d.settings.feedFilter).toBe("all");
    expect(d.settings.listFilter).toBe("g2");
  });

  test("countByGroup", () => {
    let s = withGroups("A", "B");
    s = core.toggleChannelGroup(s, "@x", "X", "g1");
    s = core.toggleChannelGroup(s, "@y", "Y", "g1");
    s = core.toggleChannelGroup(s, "@y", "Y", "g2");
    expect(core.countByGroup(s)).toEqual({ counts: { g1: 2, g2: 1 }, assigned: 2 });
  });
});

describe("channel assignment", () => {
  test("toggle on and off removes empty records", () => {
    let s = withGroups("A");
    s = core.toggleChannelGroup(s, "@x", "Chan X", "g1");
    expect(core.groupsOf(s, "@x")).toEqual(["g1"]);
    expect(s.channels["@x"].n).toBe("Chan X");
    s = core.toggleChannelGroup(s, "@x", "Chan X", "g1");
    expect(s.channels).toEqual({});
  });

  test("unknown group ids and invalid keys are ignored", () => {
    const s = withGroups("A");
    expect(core.toggleChannelGroup(s, "@x", "X", "gNope").channels).toEqual({});
    expect(core.setChannelGroups(s, "not a key", "X", ["g1"])).toBe(s);
  });

  test("several keys of one element write under the best key and drop the others", () => {
    let s = withGroups("A", "B");
    s = core.setChannelGroups(s, UC, "X", ["g1"]);
    expect(core.groupsOfAny(s, ["@x", UC]).toSorted()).toEqual(["g1"]);
    s = core.toggleChannelGroup(s, ["@x", UC], "X", "g2");
    expect(Object.keys(s.channels)).toEqual(["@x"]);
    expect(s.channels["@x"].g.toSorted()).toEqual(["g1", "g2"]);
  });

  test("the name is kept when a later call has none", () => {
    let s = withGroups("A", "B");
    s = core.toggleChannelGroup(s, "@x", "Chan X", "g1");
    s = core.toggleChannelGroup(s, "@x", "", "g2");
    expect(s.channels["@x"].n).toBe("Chan X");
  });

  test("resolveByName only answers for a unique name", () => {
    let s = withGroups("A");
    s = core.toggleChannelGroup(s, "@a", "Same Name", "g1");
    s = core.toggleChannelGroup(s, "@b", "Other", "g1");
    expect(core.resolveByName(s, "  other ")).toBe("@b");
    expect(core.resolveByName(s, "unknown")).toBeNull();
    s = core.toggleChannelGroup(s, "@c", "same name", "g1");
    expect(core.resolveByName(s, "Same Name")).toBeNull();
    expect(core.resolveByName(s, "")).toBeNull();
  });
});

const watched = (pct) => ({ isShort: false, watchedPct: pct });

describe("feed decisions", () => {
  const base = { ...core.DEFAULT_SETTINGS };
  test("matchesFilter", () => {
    expect(core.matchesFilter("all", [])).toBe(true);
    expect(core.matchesFilter("none", [])).toBe(true);
    expect(core.matchesFilter("none", ["g1"])).toBe(false);
    expect(core.matchesFilter("g1", ["g1", "g2"])).toBe(true);
    expect(core.matchesFilter("g1", [])).toBe(false);
  });

  test("shorts", () => {
    expect(
      core.decideFeedItem({ isShort: true, watchedPct: null }, { ...base, hideShorts: true }, []),
    ).toEqual({ hide: true, reason: "short" });
    expect(core.decideFeedItem({ isShort: true, watchedPct: null }, base, []).hide).toBe(false);
  });

  test("watched uses the threshold, null means no progress bar", () => {
    const s = { ...base, hideWatched: true, watchedThreshold: 80 };
    expect(core.decideFeedItem(watched(79), s, []).hide).toBe(false);
    expect(core.decideFeedItem(watched(80), s, [])).toEqual({ hide: true, reason: "watched" });
    expect(core.decideFeedItem(watched(100), s, []).hide).toBe(true);
    expect(core.decideFeedItem(watched(null), s, []).hide).toBe(false);
    expect(core.decideFeedItem(watched(100), base, []).hide).toBe(false);
  });

  test("group filter and reason priority", () => {
    const s = { ...base, feedFilter: "g1", hideShorts: true, hideWatched: true };
    expect(core.decideFeedItem(watched(null), s, ["g1"]).hide).toBe(false);
    expect(core.decideFeedItem(watched(null), s, ["g2"])).toEqual({ hide: true, reason: "group" });
    expect(core.decideFeedItem({ isShort: true, watchedPct: 100 }, s, ["g1"]).reason).toBe("short");
    expect(core.decideFeedItem(watched(100), s, ["g1"]).reason).toBe("watched");
  });

  test("parsePercent", () => {
    expect(core.parsePercent("42%")).toBe(42);
    expect(core.parsePercent("width: 12.5%;")).toBe(12.5);
    expect(core.parsePercent("width:150%")).toBe(100);
    expect(core.parsePercent("width:-3%")).toBe(0);
    expect(core.parsePercent("12px")).toBeNull();
    expect(core.parsePercent("")).toBeNull();
    expect(core.parsePercent(null)).toBeNull();
  });
});

describe("sortRanks", () => {
  const items = [
    { key: "@b", name: "beta" },
    { key: "@a", name: "Alpha" },
    { key: null, name: "10 videos" },
    { key: "@c", name: "gamma" },
    { key: "@d", name: "alpha" },
  ];

  test("default leaves YouTube's order", () => {
    expect(core.sortRanks(items, "default", core.emptyState())).toBeNull();
    expect(core.sortRanks(items, "nope", core.emptyState())).toBeNull();
  });

  test("alpha is case-insensitive, numeric-aware and stable", () => {
    // 10 videos < Alpha (item 1) < alpha (item 4) < beta < gamma
    expect(core.sortRanks(items, "alpha", core.emptyState())).toEqual([3, 1, 0, 4, 2]);
  });

  test("group orders by group position then name, ungrouped last", () => {
    let s = withGroups("FGC", "Dessin");
    s = core.toggleChannelGroup(s, "@c", "gamma", "g2");
    s = core.toggleChannelGroup(s, "@b", "beta", "g1");
    s = core.toggleChannelGroup(s, "@d", "alpha", "g2");
    s = core.toggleChannelGroup(s, "@d", "alpha", "g1"); // @d is in both: best (lowest) group wins
    const ranks = core.sortRanks(items, "group", s);
    const ordered = items
      .map((item, i) => [ranks[i], item.name])
      .toSorted((x, y) => x[0] - y[0])
      .map((x) => x[1]);
    expect(ordered).toEqual(["alpha", "beta", "gamma", "10 videos", "Alpha"]);
  });
});

function sample() {
  let s = withGroups("FGC", "Dessin");
  s = core.toggleChannelGroup(s, "@a", "A", "g1");
  s = core.toggleChannelGroup(s, UC, "B", "g2");
  s = core.learnAlias(s, "@b", UC);
  return { ...s, settings: { ...s.settings, hideShorts: true, feedFilter: "g1" } };
}

describe("export / import", () => {
  test("roundtrip through JSON text", () => {
    const s = sample();
    const text = JSON.stringify(core.exportState(s, new Date("2026-10-06T00:00:00Z")));
    const res = core.validateImport(text);
    expect(res.ok).toBe(true);
    expect(res.state).toEqual(s);
    expect(res.warnings).toEqual([]);
    expect(JSON.parse(text).exportedAt).toBe("2026-10-06T00:00:00.000Z");
  });

  test("rejects malformed files", () => {
    expect(core.validateImport("{nope").ok).toBe(false);
    expect(core.validateImport("[]").ok).toBe(false);
    expect(core.validateImport("null").ok).toBe(false);
    expect(core.validateImport({ format: "other", version: 1, groups: [], channels: {} }).ok).toBe(
      false,
    );
    expect(
      core.validateImport({ format: core.FORMAT, version: 99, groups: [], channels: {} }).ok,
    ).toBe(false);
    expect(
      core.validateImport({ format: core.FORMAT, version: 1, groups: {}, channels: {} }).errors,
    ).toContain("groups must be an array");
    expect(core.validateImport({ format: core.FORMAT, version: 1, groups: [] }).errors).toContain(
      "channels must be an object",
    );
    expect(core.validateImport("x".repeat(core.LIMITS.importBytes + 1)).ok).toBe(false);
  });

  test("hostile keys cannot reach the prototype", () => {
    const text = `{"format":"${core.FORMAT}","version":1,"groups":[{"id":"g1","name":"A","color":"#112233"}],"channels":{"__proto__":{"g":["g1"]},"constructor":{"g":["g1"]},"@ok":{"n":"ok","g":["g1"]}},"aliases":{"__proto__":"@ok"}}`;
    const res = core.validateImport(text);
    expect(res.ok).toBe(true);
    expect(Object.keys(res.state.channels)).toEqual(["@ok"]);
    expect(Object.keys(res.state.aliases)).toEqual([]);
    expect({}.polluted).toBeUndefined();
  });

  test("merge unions groups by id or name and assignments", () => {
    const current = (() => {
      let s = withGroups("FGC");
      s = core.toggleChannelGroup(s, "@a", "A", "g1");
      return s;
    })();
    const incoming = core.normalizeState({
      groups: [
        { id: "zz", name: "fgc", color: "#111111" }, // same name, other id
        { id: "g9", name: "Musique", color: "#222222" },
      ],
      channels: { "@a": { n: "A", g: ["g9"] }, "@new": { n: "New", g: ["zz"] } },
    }).state;
    const merged = core.mergeImport(current, incoming, "merge");
    expect(merged.groups.map((g) => g.name)).toEqual(["FGC", "Musique"]);
    const musique = merged.groups[1].id;
    expect(merged.channels["@a"].g.toSorted()).toEqual(["g1", musique].toSorted());
    expect(merged.channels["@new"].g).toEqual(["g1"]);
    expect(merged.settings).toEqual(current.settings);
    expect(current.groups).toHaveLength(1); // inputs untouched
  });

  test("replace returns the imported state", () => {
    const current = withGroups("Old");
    const incoming = sample();
    expect(core.mergeImport(current, incoming, "replace")).toBe(incoming);
  });
});
