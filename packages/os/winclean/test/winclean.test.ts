// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";

import { TOOL_NAMES, Winclean } from "../src";

describe("kernel-backed winclean facade", () => {
  const wc = Winclean.open();

  test("exposes the canonical catalog", () => {
    expect(wc.listTools().map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(wc.listTools().find((tool) => tool.name === "analyze_pe")?.inputSchema).toMatchObject({
      type: "object",
      required: ["path"],
      properties: { path: { type: "string" } },
    });
  });

  test("does not expose a synchronous DLL path", () => {
    expect(() => wc.callSync("get_os_info")).toThrow(/kernel/);
  });
});
