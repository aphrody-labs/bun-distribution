// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
