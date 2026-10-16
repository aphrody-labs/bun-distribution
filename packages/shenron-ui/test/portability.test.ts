// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

import { checkNoEscapingImports, checkPackageRuntimes, listExportEntries } from "@aphrody/bun-workspace/guards";

const pkgDir = fileURLToPath(new URL("..", import.meta.url));
const WRAPPERS = [
  "accordion",
  "alert-dialog",
  "avatar",
  "badge",
  "button",
  "card",
  "checkbox",
  "collapsible",
  "dialog",
  "dropdown-menu",
  "input",
  "label",
  "pagination",
  "popover",
  "progress",
  "radio-group",
  "select",
  "separator",
  "slider",
  "switch",
  "tabs",
  "textarea",
  "toast",
  "toggle",
  "tooltip",
  "toriyama-badge",
  "toriyama-panel",
  "toriyama-progress",
  "toriyama-slider",
  "toriyama-speech-bubble",
];

describe("@shenron/ui portability", () => {
  test("every wrapper is exported with the react class", () => {
    const entries = listExportEntries(pkgDir).filter(e => e.key === "./*");
    expect(entries.map(e => e.subpath.slice(2)).sort()).toEqual([...WRAPPERS].sort());
    for (const e of entries) expect(e.runtime).toBe("react");
  });

  test("runtime classes hold (no next/, no server modules)", async () => {
    expect(await checkPackageRuntimes(pkgDir)).toEqual([]);
  });

  test("no @/ alias and no escaping relative imports", async () => {
    expect(await checkNoEscapingImports(pkgDir)).toEqual([]);
  });
});
