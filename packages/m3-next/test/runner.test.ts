// SPDX-License-Identifier: Apache-2.0
// The m3-next runner: Next on Bun, with a `node` that is Bun first on PATH.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdtempSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { bunNodeShim, nextBin, nextCommand } from "../bin/m3-next";

const scratch = mkdtempSync(join(tmpdir(), "m3-next-runner-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("bunNodeShim", () => {
  test("creates a `node` that is this Bun, and is idempotent", () => {
    const dir = join(scratch, "a");
    expect(bunNodeShim(dir)).toBe(dir);
    const link = join(dir, "node");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(process.execPath);
    expect(bunNodeShim(dir)).toBe(dir);
    expect(readlinkSync(link)).toBe(process.execPath);
  });

  test("repairs a shim that points somewhere else", () => {
    const dir = join(scratch, "b");
    bunNodeShim(dir);
    rmSync(join(dir, "node"));
    symlinkSync("/nonexistent/node", join(dir, "node"));
    bunNodeShim(dir);
    expect(readlinkSync(join(dir, "node"))).toBe(process.execPath);
  });

  test("the shim runs scripts as Bun", async () => {
    const dir = bunNodeShim(join(scratch, "c"));
    const proc = Bun.spawn([join(dir, "node"), "-e", "console.log(typeof Bun)"], {
      stdout: "pipe",
    });
    expect((await new Response(proc.stdout).text()).trim()).toBe("object");
  });
});

describe("nextCommand", () => {
  test("resolves the app's next and runs it with --bun, the shim first on PATH", () => {
    const shim = bunNodeShim(join(scratch, "d"));
    const { cmd, env } = nextCommand(["build", "--webpack"], join(import.meta.dir, ".."), shim);
    expect(cmd[0]).toBe(process.execPath);
    expect(cmd[1]).toBe("--bun");
    expect(cmd[2]).toBe(nextBin(join(import.meta.dir, "..")));
    expect(existsSync(cmd[2]!)).toBe(true);
    expect(cmd.slice(3)).toEqual(["build", "--webpack"]);
    expect(env["PATH"]!.startsWith(`${shim}${delimiter}`)).toBe(true);
    expect(env["NEXT_TELEMETRY_DISABLED"]).toBeDefined();
  });

  test("an app without next fails loudly", () => {
    expect(() => nextBin(scratch)).toThrow();
  });
});
