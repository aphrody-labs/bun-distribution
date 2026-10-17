// SPDX-License-Identifier: Apache-2.0
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { writeFiles } from "../src/util.ts";
import { cleanup, tmp } from "./helpers.ts";
afterAll(cleanup);

test("generated deployment files remain within the destination, including symlink boundaries", async () => {
  const root = tmp();
  const outside = tmp();
  await expect(writeFiles(root, [{ path: "../escape", content: "bad" }])).rejects.toThrow("escapes");
  expect(await writeFiles(root, [{ path: "nested/service.conf", content: "safe" }])).toEqual([
    join(root, "nested/service.conf"),
  ]);
  expect(await Bun.file(join(root, "nested/service.conf")).text()).toBe("safe");
  if (process.platform !== "win32") {
    mkdirSync(join(root, "deploy"));
    symlinkSync(outside, join(root, "deploy/external"), "dir");
    await expect(writeFiles(root, [{ path: "deploy/external/private", content: "bad" }])).rejects.toThrow("symlink");
    expect(await Bun.file(join(outside, "private")).exists()).toBe(false);
  }
});
