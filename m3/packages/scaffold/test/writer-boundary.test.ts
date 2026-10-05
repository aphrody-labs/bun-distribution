// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFiles } from "../src/files";

let directory: string | undefined;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("scaffold destination boundary", () => {
  test("rejects non-portable template paths before writing any file", async () => {
    directory = await mkdtemp(join(tmpdir(), "m3-scaffold-path-"));
    await Promise.all(
      ["", "../escape", "C:/escape", "C:\\escape", "\\\\host\\escape", "safe\\..\\escape"].map(
        (path) =>
          expect(
            writeFiles(
              join(directory!, "output"),
              { "first.txt": "first", [path]: "escape" },
              "overwrite",
            ),
          ).rejects.toThrow("unsafe path"),
      ),
    );

    expect(await Bun.file(join(directory, "output/first.txt")).exists()).toBe(false);
  });

  test("refuses file and directory links without modifying the external destination", async () => {
    directory = await mkdtemp(join(tmpdir(), "m3-scaffold-link-"));
    const output = join(directory, "output");
    const outside = join(directory, "outside");
    await mkdir(output);
    await mkdir(outside);
    await writeFile(join(outside, "data.txt"), "preserved");
    await symlink(outside, join(output, "linked"));
    await symlink(join(outside, "data.txt"), join(output, "data.txt"));
    await Promise.all(
      ["linked/data.txt", "data.txt"].map((path) =>
        expect(
          writeFiles(output, { "first.txt": "first", [path]: "replacement" }, "overwrite"),
        ).rejects.toThrow("symbolic link"),
      ),
    );

    expect(await Bun.file(join(outside, "data.txt")).text()).toBe("preserved");
    expect(await Bun.file(join(output, "first.txt")).exists()).toBe(false);
  });
});
