// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  COMPANIONS,
  coreutilsFeature,
  installArgs,
  installRoot,
  missingUtilities,
  repoRoot,
} from "./build-uutils-coreutils.ts";

describe("build-uutils-coreutils", () => {
  test("installs into the directory the kernel coreutils subsystem resolves", () => {
    expect(installRoot).toBe(join(repoRoot, "target", "aphrody-uutils", "coreutils"));
  });

  test("selects the coreutils feature set per platform", () => {
    expect(coreutilsFeature("win32")).toBe("windows");
    expect(coreutilsFeature("linux")).toBe("unix");
    expect(() => coreutilsFeature("aix")).toThrow("only wired");
  });

  test("builds locked cargo install arguments", () => {
    expect(installArgs({ crate: "coreutils", version: "0.12.0" }, "windows")).toEqual([
      "install",
      "--root",
      installRoot,
      "--locked",
      "--force",
      "--version",
      "0.12.0",
      "coreutils",
      "--features",
      "windows",
    ]);
    expect(installArgs({ path: "third_party/uutils-grep" })).toEqual([
      "install",
      "--root",
      installRoot,
      "--locked",
      "--force",
      "--path",
      "third_party/uutils-grep",
    ]);
  });

  test("reports missing required utilities", () => {
    expect(missingUtilities("cat\ncp\nls\nrm\nsha256sum\nsort\nwhoami\n")).toEqual([]);
    expect(missingUtilities("cat cp", ["cat", "ls"])).toEqual(["ls"]);
  });

  test("covers every companion repository of the kernel subsystem", () => {
    expect(COMPANIONS.map(companion => companion.repository)).toEqual([
      "uutils-findutils",
      "uutils-diffutils",
      "uutils-sed",
      "uutils-grep",
      "uutils-tar",
    ]);
  });
});
