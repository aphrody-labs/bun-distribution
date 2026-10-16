// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { buildArgs, parseArgs, releaseTag } from "./container-image";

describe("container-image", () => {
  test("parses command and options", () => {
    const { command, options } = parseArgs([
      "release",
      "--host",
      "dbfr",
      "--host",
      "vps",
      "--ref",
      "ghcr.io/a/b",
    ]);
    expect(command).toBe("release");
    expect(options.hosts).toEqual(["dbfr", "vps"]);
    expect(options.ref).toBe("ghcr.io/a/b");
  });
  test("rejects unknown flags", () => {
    expect(() => parseArgs(["build", "--nope"])).toThrow();
  });
  test("tag falls back to the commit and is validated", () => {
    expect(releaseTag("", "abc123def\n")).toBe("abc123def");
    expect(() => releaseTag("a b", "")).toThrow();
  });
  test("build targets runtime and passes the release", () => {
    const args = buildArgs("t1", "r9");
    expect(args).toContain("runtime");
    expect(args).toContain("APHRODY_RELEASE=r9");
    expect(args.at(-1)).toBe(".");
  });
});
