import { describe, expect, test } from "bun:test";
import { runEnginePackageManager } from "../src/package-manager";

describe("bep package manager", () => {
  test("rejects unknown commands with the usage", async () => {
    await expect(runEnginePackageManager(["frobnicate"])).rejects.toThrow("bep install");
  });

  test("requires a package for add", async () => {
    await expect(runEnginePackageManager(["add"])).rejects.toThrow("usage:");
  });
});
