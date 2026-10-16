import { describe, expect, test } from "bun:test";
import { binaryFormatLoaders, consoleIds, consolePlugins, formatPlugins } from "../src/plugins";

describe("Bun console plugins", () => {
  test("owns one plugin per console", () => {
    expect(new Set(consoleIds).size).toBe(consoleIds.length);
    expect(consolePlugins).toHaveLength(consoleIds.length);
    expect(consolePlugins.map(({ name }) => name)).toEqual(consoleIds.map(console => `bun-engine:console:${console}`));
  });

  test("owns one loader plugin per binary format", () => {
    expect(formatPlugins).toHaveLength(binaryFormatLoaders.length);
    expect(new Set(binaryFormatLoaders.map(({ id }) => id)).size).toBe(binaryFormatLoaders.length);
    for (const loader of binaryFormatLoaders) {
      expect(loader.extensions.length).toBeGreaterThan(0);
      expect(loader.plugin.name).toBe(`bun-engine:loader:${loader.id}`);
    }
  });
});
