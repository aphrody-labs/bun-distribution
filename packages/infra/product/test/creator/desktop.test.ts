// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  creatorArgv,
  creatorCatalog,
  crashReport,
  desktopMain,
} from "../../src/creator/desktop.ts";
import { logCrash } from "../../src/shared/crash.ts";
import { desktopCandidates, findDesktop, openInDesktop } from "../../src/shared/desktop-launch.ts";
import { argvFor, askKind, KitInputError, memoryChannel } from "../../src/shared/desktop.ts";

test("the catalog covers every command and keeps the command lines private", () => {
  const catalog = creatorCatalog();
  expect(catalog.protocol).toBe("aphrody.kit/1");
  const ids = catalog.actions.map((action) => action.id);
  for (const id of [
    "challonge-create",
    "wiki-images",
    "adobe-apply",
    "disk-scan",
    "update",
    "crash-report",
  ])
    expect(ids).toContain(id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(catalog.actions.every((action) => !("argv" in action))).toBe(true);
  for (const action of catalog.actions)
    expect(catalog.groups.some((group) => group.id === action.group)).toBe(true);
  expect(catalog.actions.find((a) => a.id === "adobe-apply")?.confirm).toBeDefined();
});

test("form values become the same command line as the terminal", () => {
  expect(
    creatorArgv("wiki-images", {
      url: "https://wiki.example/wiki/Page",
      category: "A, B",
      dryRun: true,
    }),
  ).toEqual([
    "wiki-images",
    "https://wiki.example/wiki/Page",
    "--category",
    "A",
    "--category",
    "B",
    "--dry-run",
  ]);
  expect(creatorArgv("disk-apply", {})).toEqual(["disk-clean", "clean", "--apply"]);
  expect(() => creatorArgv("challonge-create", {})).toThrow(KitInputError);
  expect(() =>
    argvFor([], [{ name: "q", label: "Q", kind: "number", flag: "--q" }], { q: "1; rm" }),
  ).toThrow("nombre");
});

test("typed confirmations are recognised", () => {
  expect(askKind("Tape OUI (en majuscules) pour arrêter")).toEqual({
    kind: "typed",
    expect: "OUI",
  });
  expect(askKind("Quel serveur ?")).toEqual({ kind: "text" });
});

test("a run streams the command output and ends with done", async () => {
  const channel = memoryChannel();
  const code = await desktopMain(
    ["run", "challonge-create", JSON.stringify({ name: "" })],
    channel,
  );
  expect(code).toBe(2);
  expect(channel.events.at(-2)).toMatchObject({ type: "error" });
  expect(channel.events.at(-1)).toEqual({ type: "done", code: 2 });
});

test("the crash report reads the crash log", () => {
  const root = mkdtempSync(join(tmpdir(), "creator-crash-"));
  const env = { LOCALAPPDATA: root };
  expect(crashReport(env)).toEqual(["Aucun plantage enregistré."]);
  logCrash(new Error("boom"), ["x"], env);
  expect(crashReport(env).join("\n")).toContain("boom");
});

test("the launcher opens the desktop route only when the app is installed", () => {
  expect(desktopCandidates({ LOCALAPPDATA: "C:\\L" }, "win32")[0]).toContain("aphrody-app.exe");
  expect(
    findDesktop(
      {},
      "linux",
      () => false,
      () => null,
    ),
  ).toBeUndefined();
  const launched: string[][] = [];
  const env = { APHRODY_DESKTOP_BIN: process.execPath };
  expect(openInDesktop("creator", env, (argv) => (launched.push(argv), true))).toBe(true);
  expect(launched).toEqual([[process.execPath, "aphrody://creator"]]);
});
