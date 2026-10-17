// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";

import { TOOL_NAMES, Winclean } from "../src";

describe("kernel-backed winclean facade", () => {
  const wc = Winclean.open();

  test("exposes the canonical catalog", () => {
    expect(
      wc
        .listTools()
        .map(t => t.name)
        .toSorted(),
    ).toEqual([...TOOL_NAMES].toSorted());
    expect(wc.listTools().find(tool => tool.name === "analyze_pe")?.inputSchema).toMatchObject({
      type: "object",
      required: ["path"],
      properties: { path: { type: "string" } },
    });
    expect(wc.listTools().find(tool => tool.name === "list_directory")?.inputSchema).toMatchObject({
      type: "object",
      required: ["path"],
      properties: {
        exclude: {
          type: "array",
          items: { type: "string", minLength: 1 },
          default: [],
        },
      },
    });
  });

  test("does not expose a synchronous DLL path", () => {
    expect(() => wc.callSync("get_os_info")).toThrow(/kernel/);
  });
});
