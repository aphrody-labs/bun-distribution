import { describe, expect, test } from "bun:test";
import { magikaSetupCommand } from "../../src/ml/magika.js";

describe("Magika ML owner", () => {
  test("installs only through Bun UV and the pinned source project", () => {
    const command = magikaSetupCommand();
    expect(command.slice(0, 3)).toEqual(["bun", "uv", "sync"]);
    expect(command).toContain("--locked");
    expect(command).toContain("--no-dev");
    expect(command.join(" ")).toContain("crates\\magika\\python");
  });
});
