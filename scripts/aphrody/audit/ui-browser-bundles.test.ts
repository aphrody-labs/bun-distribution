// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { classify, exportTargets, SERVER_ONLY } from "./ui-browser-bundles.ts";

describe("ui browser bundle gate", () => {
  test("exportTargets ignores types conditions and nests", () => {
    const targets = exportTargets({
      ".": { types: "./a.d.ts", bun: "./src/a.ts", default: "./dist/a.js" },
      "./b": "./b.js",
    });
    expect([...targets].toSorted()).toEqual([
      "./b.js",
      "./dist/a.js",
      "./src/a.ts",
    ]);
  });

  test("classify distinguishes expected and unexpected failures", () => {
    const serverOnly = Object.keys(SERVER_ONLY)[0]!;
    expect(classify("m3-primitives/src/index.ts", true, false)).toBe("ok");
    expect(classify(serverOnly, false, false)).toBe("server-only");
    expect(classify("m3-primitives/src/index.ts", false, false)).toBe(
      "unexpected-failure",
    );
    expect(classify(serverOnly, true, false)).toBe("stale-allowlist");
    expect(classify("m3-icons/src/browser.tsx", true, true)).toBe(
      "native-in-bundle",
    );
  });
});
