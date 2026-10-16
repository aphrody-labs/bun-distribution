import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  cache,
  free,
  pick,
  type Io,
  type ProcInfo,
} from "../../src/creator/commands/adobe-clean.ts";

function fakeIo(procs: ProcInfo[], env: Record<string, string>) {
  const logs: string[] = [];
  const killed: string[][] = [];
  const io: Io = {
    list: async () => procs,
    kill: async (names) => void killed.push(names),
    env,
    log: (line) => void logs.push(line),
  };
  return { io, logs, killed };
}

test("pick matches names case-insensitively without .exe", () => {
  const procs = [
    { name: "Photoshop.exe", pid: 1, bytes: 10 },
    { name: "notepad", pid: 2, bytes: 5 },
  ];
  expect(pick(procs, ["Photoshop"]).map((p) => p.pid)).toEqual([1]);
});

test("free never closes helpers while a creative app runs", async () => {
  const { io, killed } = fakeIo(
    [
      { name: "Photoshop", pid: 1, bytes: 1 },
      { name: "CCXProcess", pid: 2, bytes: 1 },
    ],
    {},
  );
  await free(io, true);
  expect(killed).toEqual([]);
});

test("free closes only background helpers with --apply", async () => {
  const procs = [
    { name: "Creative Cloud Helper.exe", pid: 2, bytes: 100 },
    { name: "chrome.exe", pid: 3, bytes: 100 },
  ];
  const dry = fakeIo(procs, {});
  await free(dry.io, false);
  expect(dry.killed).toEqual([]);
  const live = fakeIo(procs, {});
  await free(live.io, true);
  expect(live.killed).toEqual([["Creative Cloud Helper"]]);
});

test("cache clears content of Adobe media cache only with --apply and refuses while an app runs", async () => {
  const appData = await mkdtemp(join(tmpdir(), "adobe-"));
  const mediaCache = join(appData, "Adobe", "Common", "Media Cache Files");
  await mkdir(mediaCache, { recursive: true });
  await writeFile(join(mediaCache, "a.cfa"), "x".repeat(2048));
  const project = join(appData, "Adobe", "Common", "project.prproj");
  await writeFile(project, "keep");

  const busy = fakeIo([{ name: "Adobe Premiere Pro", pid: 9, bytes: 1 }], {
    APPDATA: appData,
  });
  expect(await cache(busy.io, true, 0, [])).toBe(1);
  expect(await readdir(mediaCache)).toEqual(["a.cfa"]);

  const dry = fakeIo([], { APPDATA: appData });
  await cache(dry.io, false, 0, []);
  expect(await readdir(mediaCache)).toEqual(["a.cfa"]);
  expect(dry.logs.join("\n")).toContain("Récupérable");

  const live = fakeIo([], { APPDATA: appData });
  await cache(live.io, true, 0, []);
  expect(await readdir(mediaCache)).toEqual([]);
  expect(await Bun.file(project).text()).toBe("keep");
});
