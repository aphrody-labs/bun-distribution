import { describe, expect, test } from "bun:test";
import { CANONICAL_GAME_FAMILIES } from "./canon";
import { RUST_RUNTIME_BY_MEDIA_KIND, RUST_RUNTIME_BY_PLATFORM, runtimeForPlatform } from "./runtime";

describe("Rust runtime coverage", () => {
  test("every canonical game family has a closest Rust target for every platform", () => {
    for (const work of CANONICAL_GAME_FAMILIES) {
      expect(work.platforms?.length).toBeGreaterThan(0);
      expect(work.runtimeLinks?.length).toBe(work.platforms?.length);
      expect(work.runtimeLinks?.every(runtime => runtime.sourcePath.startsWith("crates.io:"))).toBeTrue();
    }
  });

  test("platform and media matrices are total and do not fake console emulation", () => {
    expect(Object.keys(RUST_RUNTIME_BY_PLATFORM).length).toBe(15);
    expect(Object.values(RUST_RUNTIME_BY_PLATFORM).some(runtime => runtime.id === "pc-format-reader")).toBeTrue();
    expect(Object.values(RUST_RUNTIME_BY_PLATFORM).filter(runtime => runtime.executesTarget)).toHaveLength(0);
    expect(Object.keys(RUST_RUNTIME_BY_MEDIA_KIND)).toHaveLength(5);
    expect(runtimeForPlatform("ds").status).toBe("closest_available");
  });
});
