// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { undeclaredDependencies } from "./undeclared-deps";

test("shared React owner bundles a real filesystem fixture on the current runtime", async () => {
  const root = mkdtempSync(join(tmpdir(), "m3-react-owner-"));
  try {
    const entry = join(root, "entry.ts");
    writeFileSync(
      entry,
      'import { createElement } from "react"; console.log(createElement("div", null, "fixture"));',
    );
    const result = await Bun.build({
      entrypoints: [entry],
      target: "browser",
      plugins: [undeclaredDependencies],
    });
    expect(result.success).toBe(true);
    expect(result.logs).toHaveLength(0);
    expect(await result.outputs[0].text()).toContain("fixture");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("plugin guest resolves from the selected host workspace outside Material", async () => {
  const root = mkdtempSync(join(tmpdir(), "m3-plugin-host-"));
  const previous = process.env.APHRODY_WORKSPACE_ROOT;
  try {
    const host = join(root, "host");
    const guest = join(host, "crates/tauri/aphrody-tauri-plugin-dialog/guest-js");
    mkdirSync(guest, { recursive: true });
    process.env.APHRODY_WORKSPACE_ROOT = host;
    writeFileSync(join(guest, "index.ts"), 'export const owner = "selected host guest";');
    const entry = join(root, "entry.ts");
    writeFileSync(entry, 'import { owner } from "@aphrody/plugin-dialog"; console.log(owner);');
    const result = await Bun.build({
      entrypoints: [entry],
      target: "browser",
      plugins: [undeclaredDependencies],
    });
    expect(result.success).toBe(true);
    expect(result.logs).toHaveLength(0);
    expect(await result.outputs[0].text()).toContain("selected host guest");
  } finally {
    if (previous === undefined) delete process.env.APHRODY_WORKSPACE_ROOT;
    else process.env.APHRODY_WORKSPACE_ROOT = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
