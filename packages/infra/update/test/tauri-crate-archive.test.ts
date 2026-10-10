// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { readCrateArchiveFile } from "../src/tauri/sync.ts";

test.each([false, true])(
  "crate archive lookup selects exact UTF-8 members (gzip: %s)",
  async (gzip) => {
    const blob = await new Bun.Archive(
      {
        "fixture-1.0.0/src/lib.rs": "// été\n",
        "fixture-1.0.0/src/[name].rs": "literal name",
        "other-1.0.0/src/lib.rs": "wrong member",
      },
      gzip ? { compress: "gzip" } : undefined,
    ).blob();
    const bytes = await blob.arrayBuffer();
    expect(await readCrateArchiveFile(bytes, "fixture-1.0.0/src/lib.rs")).toBe("// été\n");
    expect(await readCrateArchiveFile(bytes, "fixture-1.0.0/src/[name].rs")).toBe("literal name");
    expect(await readCrateArchiveFile(bytes, "fixture-1.0.0/missing.rs")).toBeNull();
  },
);

test("invalid crate archives retain the unavailable-file result", async () => {
  expect(
    await readCrateArchiveFile(new TextEncoder().encode("not a tarball").buffer, "src/lib.rs"),
  ).toBeNull();
});
