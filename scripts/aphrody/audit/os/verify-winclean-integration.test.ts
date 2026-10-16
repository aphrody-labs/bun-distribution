// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { catalogHash, ledgerDrift } from "./verify-winclean-integration.ts";

describe("verify-winclean-integration", () => {
  const text = '{\r\n  "tools": [{ "name": "a" }, { "name": "b" }]\r\n}\r\n';

  test("hashes the catalog as its LF blob", () => {
    expect(catalogHash(text)).toBe(catalogHash(text.replaceAll("\r\n", "\n")));
  });

  test("accepts an agreeing ledger and reports each drift", () => {
    const ledger = {
      catalog_sha256: catalogHash(text),
      catalog_tool_count: 2,
      tools: ["b", "a"],
    };
    expect(ledgerDrift(["a", "b"], text, ledger)).toEqual([]);
    expect(ledgerDrift(["a", "b"], `${text} `, ledger)).toEqual([
      "ledger schema hash drift",
    ]);
    expect(ledgerDrift(["a", "c"], text, ledger)).toEqual([
      "ledger names diverge from the frozen catalog",
    ]);
    expect(ledgerDrift(["a", "b", "c"], text, ledger)).toContain(
      "ledger count drift: declared=2 ledger=2 catalog=3",
    );
    expect(
      ledgerDrift(["a", "b"], text, { ...ledger, tools: ["a", "a"] }),
    ).toEqual(["ledger names diverge from the frozen catalog"]);
  });
});
