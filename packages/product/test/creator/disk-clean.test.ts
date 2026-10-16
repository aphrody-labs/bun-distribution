import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  clean,
  dupes,
  type Io,
} from "../../src/creator/commands/disk-clean.ts";
import { catalog } from "../../src/creator/commands/disk-clean/catalog.ts";
import {
  findDuplicates,
  walk,
} from "../../src/creator/commands/disk-clean/scan.ts";

const io = (env: Record<string, string>, names: string[] = []) => {
  const logs: string[] = [];
  const value: Io = {
    env,
    list: async () => names.map((name, i) => ({ name, pid: i + 1, bytes: 1 })),
    log: (line) => void logs.push(line),
    platform: "linux",
  };
  return { io: value, logs };
};

test("windows catalog never targets user document folders", () => {
  const targets = catalog(
    {
      LOCALAPPDATA: "C:\\L",
      APPDATA: "C:\\R",
      USERPROFILE: "C:\\U",
      TEMP: "C:\\T",
    },
    "win32",
  );
  const all = targets.flatMap((t) => t.patterns).join("\n");
  expect(all).not.toMatch(/Documents|Desktop|Downloads|Pictures/);
  expect(targets.find((t) => t.id === "chrome")?.lockedBy).toEqual(["chrome"]);
});

test("clean (unix catalog) removes cache content, keeps the folder, skips locked browsers", async () => {
  const home = await mkdtemp(join(tmpdir(), "disk-"));
  const pipCache = join(home, ".cache", "pip");
  await mkdir(pipCache, { recursive: true });
  await writeFile(join(pipCache, "wheel.whl"), "x".repeat(4096));
  const env = { HOME: home, XDG_CACHE_HOME: join(home, ".cache") };

  const dry = io(env);
  await clean(dry.io, false, ["pip"]);
  expect(await readdir(pipCache)).toEqual(["wheel.whl"]);
  expect(dry.logs.join("\n")).toContain("Récupérable");

  const live = io(env);
  await clean(live.io, true, ["pip"]);
  expect(await readdir(pipCache)).toEqual([]);
});

test("findDuplicates groups identical content only", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dupes-"));
  await writeFile(join(dir, "a.bin"), "same-content-1234");
  await writeFile(join(dir, "b.bin"), "same-content-1234");
  await writeFile(join(dir, "c.bin"), "diff-content-1234");
  await mkdir(join(dir, "sub"));
  await writeFile(join(dir, "sub", "d.bin"), "same-content-1234");
  const groups = await findDuplicates(dir, 1);
  expect(groups).toHaveLength(1);
  expect(groups[0]?.paths).toHaveLength(3);
  expect(groups[0]?.wasted).toBe(2 * "same-content-1234".length);
});

test("walk ranks biggest files and dirs, dupes command writes report", async () => {
  const dir = await mkdtemp(join(tmpdir(), "walk-"));
  await mkdir(join(dir, "big"));
  await writeFile(join(dir, "big", "x.bin"), "x".repeat(5000));
  await writeFile(join(dir, "small.txt"), "x");
  const result = await walk(dir, { topFiles: 1 });
  expect(result.files[0]?.path).toBe(join(dir, "big", "x.bin"));
  expect(result.topDirs[0]?.bytes).toBe(5000);

  const report = join(dir, "report.json");
  const { io: i } = io({});
  expect(await dupes(i, dir, 0, 5, report)).toBe(0);
  expect(JSON.parse(await Bun.file(report).text())).toEqual([]);
});
