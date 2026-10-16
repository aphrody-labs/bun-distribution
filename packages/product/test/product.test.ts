// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { join } from "node:path";
import { productArgs, VERSION } from "../src/cli.ts";

function run(...args: string[]) {
  return Bun.spawnSync(
    [process.execPath, join(import.meta.dir, "../src/cli.ts"), ...args],
    {
      windowsHide: true,
      env: { ...process.env, APHRODY_SETUP_NO_UPDATE: "1" },
    },
  );
}

test("one entrypoint contains setup, administrator and creator modules with the same version", () => {
  for (const role of [[], ["setup"], ["admin"], ["creator"]]) {
    const result = run(...role, "--version");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe(VERSION);
  }
  expect(run("admin", "--help").stdout.toString()).toContain("entrainement");
  expect(run("creator", "--help").stdout.toString()).toContain(
    "video-translate",
  );
});

test("both desktop routes use the same executable and retain their protocol and action catalogs", () => {
  for (const role of ["admin", "creator"]) {
    const result = run(role, "desktop", "catalog");
    expect(result.exitCode).toBe(0);
    const messages = result.stdout
      .toString()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(
      messages.some((message) => message.catalog?.protocol === "aphrody.kit/1"),
    ).toBe(true);
    expect(result.stdout.toString()).toContain(
      role === "admin" ? "entrainement" : "challonge",
    );
  }
});

test("historical executable names select a role without a second implementation", () => {
  expect(productArgs(["verifier"], "Aphrody-Omar.exe")).toEqual([
    "admin",
    "verifier",
  ]);
  expect(productArgs(["--help"], "creator-kit.exe")).toEqual([
    "creator",
    "--help",
  ]);
  expect(productArgs(["--oui"], "Aphrody-Setup.exe")).toEqual(["--oui"]);
});
