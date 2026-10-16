// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  defineM3Config,
  findM3Config,
  loadM3Config,
  resolveM3Config,
} from "../src/config.ts";
import { FIXTURE, tempDir } from "./helpers.ts";

describe("m3.config.ts", () => {
  test("loads the fixture config and resolves its paths against the config directory", async () => {
    const config = await loadM3Config(FIXTURE);
    expect(config.file).toBe(join(FIXTURE, "m3.config.ts"));
    expect(config.dir).toBe(FIXTURE);
    expect(config.entry).toBe(join(FIXTURE, "index.html"));
    expect(config.outdir).toBe(join(FIXTURE, "dist"));
    expect(config.tauri?.uiDist).toBe(join(FIXTURE, "ui-dist"));
    expect(config.proxy).toEqual({ "/rpc": "http://127.0.0.1:9" });
    expect(config.theme).toEqual({
      seed: "#336699",
      variant: "vibrant",
      contrast: 0.5,
    });
    expect(config.port).toBe(0);
  });

  test("an explicit file wins over the lookup; .js configs load too", async () => {
    await using tmp = await tempDir();
    await Bun.write(
      join(tmp.dir, "custom.config.js"),
      'export default { entry: "pages/main.html", pagesDir: "pages/react", routes: { "/about": "pages/about.html" } };\n',
    );
    const config = await loadM3Config(tmp.dir, "custom.config.js");
    expect(config.entry).toBe(join(tmp.dir, "pages/main.html"));
    expect(config.routes).toEqual({
      "/about": join(tmp.dir, "pages/about.html"),
    });
    expect(config.pagesDir).toBe(join(tmp.dir, "pages/react"));
    expect(config.outdir).toBe(join(tmp.dir, "dist"));
    expect(config.tauri).toBeUndefined();
  });

  test("lookup order and missing config", async () => {
    await using tmp = await tempDir();
    expect(findM3Config(tmp.dir)).toBeUndefined();
    await expect(loadM3Config(tmp.dir)).rejects.toThrow("no m3.config.ts");
    await Bun.write(
      join(tmp.dir, "m3.config.mjs"),
      'export default { entry: "a.html" };\n',
    );
    await Bun.write(
      join(tmp.dir, "m3.config.ts"),
      'export default { entry: "b.html" };\n',
    );
    expect(findM3Config(tmp.dir)).toBe(join(tmp.dir, "m3.config.ts"));
  });

  test("validation: entry, proxy prefix and target", () => {
    expect(() => resolveM3Config({} as never, "/x")).toThrow(
      "`entry` must be a non-empty string",
    );
    expect(() =>
      resolveM3Config({ entry: "a.html", proxy: { rpc: "http://h" } }, "/x"),
    ).toThrow('must start with "/"');
    expect(() =>
      resolveM3Config(
        { entry: "a.html", proxy: { "/rpc": "not a url" } },
        "/x",
      ),
    ).toThrow("is not a URL");
    expect(defineM3Config({ entry: "a.html" })).toEqual({ entry: "a.html" });
  });
});
