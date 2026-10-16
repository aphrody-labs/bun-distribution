// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { flagValue, runApp } from "../src/entry.ts";

describe("flagValue", () => {
  test("--name value and --name=value", () => {
    expect(flagValue(["--port", "8080"], "port")).toBe("8080");
    expect(flagValue(["--port=9090", "--x"], "port")).toBe("9090");
    expect(flagValue(["--x"], "port")).toBeUndefined();
  });
});

describe("runApp command line", () => {
  const base = {
    name: "demo",
    version: "1.0.0",
    buildId: "abc",
    port: 3000,
    files: {},
  };
  const capture = async (argv: string[]) => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => void lines.push(args.join(" "));
    try {
      await runApp(base, argv);
    } finally {
      console.log = original;
    }
    return lines;
  };

  test("--version prints name, version and build id and returns", async () => {
    expect(await capture(["--version"])).toEqual(["demo 1.0.0 (abc)"]);
  });

  test("--healthcheck sets a failing exit code when nothing listens, and rejects a bad port", async () => {
    const saved = process.exitCode;
    const savedPort = Bun.env.PORT;
    try {
      Bun.env.PORT = "1";
      await runApp(base, ["--healthcheck"]);
      expect(process.exitCode).toBe(1);
      Bun.env.PORT = "70000";
      await expect(runApp(base, [])).rejects.toThrow(/invalid port/);
    } finally {
      // Bun ignores an undefined assignment after an exit code has been set.
      process.exitCode = saved ?? 0;
      if (savedPort === undefined) delete Bun.env.PORT;
      else Bun.env.PORT = savedPort;
    }
  });
});
