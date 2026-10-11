// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { mergeIntoMemory, omarChecklist, FICHE_BEGIN, FICHE_END } from "../src/host/fiche.ts";

describe("fiche", () => {
  test("la liste d'Omar se coche d'après les faits en direct", () => {
    const block = "NET_LIVE_OMAR_PORTS_OPEN=22,5900\nNET_LIVE_OMAR_WG_ONLINE=yes";
    const l = omarChecklist(block);
    expect(l[0]).toStartWith("[x]");
    expect(l.find((x) => x.includes("5900"))).toStartWith("[x]");
    expect(l.find((x) => x.includes("8795"))).toStartWith("[ ]");
  });
  test("le bloc auto-synchronisé est remplacé, le reste conservé", () => {
    const once = mergeIntoMemory("# a\nmanuel", "v1");
    const twice = mergeIntoMemory(once, "v2");
    expect(twice).toContain("manuel");
    expect(twice).toContain("v2");
    expect(twice).not.toContain("v1");
    expect(twice.split(FICHE_BEGIN).length).toBe(2);
    expect(twice).toContain(FICHE_END);
  });
});
