// apps/web: the desktop webview bundles (tsconfig path @aphrody/api -> vendor/tauri) and ships its favicon.
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const app = resolve(import.meta.dir, "../../../../apps/yolo/web");

describe("apps/yolo/web", () => {
  test("src/main.ts bundles for the browser", async () => {
    const result = await Bun.build({
      entrypoints: [resolve(app, "src/main.ts")],
      target: "browser",
    });
    expect(result.success).toBe(true);
    expect(await result.outputs[0]!.text()).toContain("get_system_stats");
  });

  test("index.html loads main.js and a favicon that exists", async () => {
    const html = await Bun.file(resolve(app, "index.html")).text();
    expect(html).toContain('src="main.js"');
    const icon = /<link[^>]+rel="icon"[^>]+href="([^"]+)"/.exec(html)?.[1];
    expect(icon).toBeDefined();
    expect(existsSync(resolve(app, icon!))).toBe(true);
  });
});
