// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { BLOCK_BEGIN, BLOCK_END, cmpVersion, matchRules, mergeFactSheet, normaliseErrors, parseCommit, replaceManagedBlock } from "../src/deps/sync.ts";

describe("cmpVersion", () => {
  test("orders releases and prereleases", () => {
    expect(cmpVersion("3.0.0-alpha.3", "3.0.0-alpha.4")).toBe(-1);
    expect(cmpVersion("3.0.0-alpha.10", "3.0.0-alpha.9")).toBe(1);
    expect(cmpVersion("3.0.0", "3.0.0-alpha.9")).toBe(1);
    expect(cmpVersion("=2.12.1", "2.12.1")).toBe(0);
    expect(cmpVersion("0.12.21", "0.12.22")).toBe(-1);
  });
});

describe("parseCommit", () => {
  test("parses conventional commits", () => {
    expect(parseCommit("abc", "2026-10-02", "feat(shell)!: add channel")).toMatchObject({ type: "feat", scope: "shell", breaking: true });
    expect(parseCommit("abc", "2026-10-02", "chore(tauri,uv): align")?.scope).toBe("tauri,uv");
    expect(parseCommit("abc", "2026-10-02", "wip stuff")).toBeUndefined();
  });
});

describe("matchRules", () => {
  const rules = [{ id: "export", match: "has no exported member", kind: "brief" as const }];
  test("matches and caps lines", () => {
    const out = "a.ts: error TS2724: '\"x\"' has no exported member named 'y'\nok";
    expect(matchRules(out, rules)[0]?.lines).toHaveLength(1);
    expect(matchRules("nothing", rules)).toEqual([]);
  });
});

describe("managed block", () => {
  test("appends then replaces in place", () => {
    const once = replaceManagedBlock("# Boot\n1. step", "first");
    expect(once).toContain(`${BLOCK_BEGIN}\nfirst\n${BLOCK_END}`);
    const twice = replaceManagedBlock(once, "second");
    expect(twice.match(new RegExp(BLOCK_BEGIN, "g"))).toHaveLength(1);
    expect(twice).toContain("second");
    expect(twice).not.toContain("first");
  });
});

describe("normaliseErrors", () => {
  test("drops positions and dedupes", () => {
    const out = "src/a.ts(10,5): error TS2307: no\nsrc/a.ts(20,1): error TS2307: no\nwarning";
    expect(normaliseErrors(out)).toEqual(["src/a.ts: error TS2307: no"]);
  });
});

import { gitSources, parseBunLock, parseCargoLock, parseRequirements, sparsePath } from "../src/deps/inventory.ts";

describe("inventory parsers", () => {
  test("sparse index paths", () => {
    expect(sparsePath("a")).toBe("1/a");
    expect(sparsePath("io")).toBe("2/io");
    expect(sparsePath("syn")).toBe("3/s/syn");
    expect(sparsePath("tokio")).toBe("to/ki/tokio");
  });
  test("Cargo.lock packages and git sources", () => {
    const lock = `[[package]]\nname = "tokio"\nversion = "1.53.1"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n\n[[package]]\nname = "candle-core"\nversion = "0.9.1"\nsource = "git+https://github.com/huggingface/candle.git?rev=66a8cf1#66a8cf184a5a"\n\n[[package]]\nname = "aphrody-x"\nversion = "1.0.0-canary"\n`;
    const pkgs = parseCargoLock(lock);
    expect(pkgs).toHaveLength(3);
    const repos = gitSources(pkgs);
    expect([...repos.keys()]).toEqual(["https://github.com/huggingface/candle"]);
  });
  test("bun.lock entries", () => {
    const lock = `    "@scope/pkg": ["@scope/pkg@1.2.3", "", {}, "sha"],\n    "left-pad": ["left-pad@1.3.0", "", {}, "sha"],\n`;
    expect(parseBunLock(lock).map((d) => `${d.name}@${d.version}`).toSorted()).toEqual(["@scope/pkg@1.2.3", "left-pad@1.3.0"]);
  });
  test("requirements pins", () => {
    expect(parseRequirements("Foo_Bar[extra]==1.0.2 \\\n  --hash=sha256:x\nplain>=1\n")).toEqual([{ name: "foo-bar", version: "1.0.2" }]);
  });
});

describe("mergeFactSheet", () => {
  const header = ["# Dependency fact sheet 2026-10-02", "", "Generated.", ""];
  test("a first run writes the header and its sections", () => {
    const out = mergeFactSheet(undefined, header, new Map([["bun", ["## bun 1.4.1 -> 1.4.2", "", "- release v1.4.2", ""]]]));
    expect(out).toBe("# Dependency fact sheet 2026-10-02\n\nGenerated.\n\n## bun 1.4.1 -> 1.4.2\n\n- release v1.4.2\n");
  });
  test("a second run the same day replaces its own library and keeps the others", () => {
    const first = mergeFactSheet(undefined, header, new Map([
      ["tauri", ["## tauri 3.0.0-alpha.3 -> 3.0.0-alpha.4", "", "- release tauri-v3.0.0-alpha.4"]],
      ["bun", ["## bun 1.4.1 -> 1.4.2", "", "- release v1.4.2"]],
    ]));
    const second = mergeFactSheet(first, header, new Map([["bun", ["## bun 1.4.2 -> 1.4.3", "", "- release v1.4.3"]], ["uv", ["## uv 0.12.21 -> 0.12.22", ""]]]));
    expect(second.match(/^## /gm)).toHaveLength(3);
    expect(second).toContain("## tauri 3.0.0-alpha.3 -> 3.0.0-alpha.4\n\n- release tauri-v3.0.0-alpha.4\n");
    expect(second).toContain("## bun 1.4.2 -> 1.4.3\n\n- release v1.4.3\n");
    expect(second).not.toContain("1.4.1 -> 1.4.2");
    expect(second.indexOf("## tauri")).toBeLessThan(second.indexOf("## bun"));
    expect(second.indexOf("## bun")).toBeLessThan(second.indexOf("## uv"));
  });
  test("library names with spaces and scopes keep their section", () => {
    const sheet = mergeFactSheet(undefined, header, new Map([["@xterm/xterm", ["## @xterm/xterm ? -> ?", "", "body"]]]));
    const again = mergeFactSheet(sheet, header, new Map([["@xterm/xterm", ["## @xterm/xterm ? -> 6.0.0", "", "new"]]]));
    expect(again.match(/^## /gm)).toHaveLength(1);
    expect(again).toContain("## @xterm/xterm ? -> 6.0.0\n\nnew\n");
  });
});
