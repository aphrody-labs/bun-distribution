// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTemplates } from "./templates-source";

const root = mkdtempSync(join(tmpdir(), "aphrody-web-templates-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("loadTemplates", () => {
  it("reads stack.toml templates, their text files and the create command", async () => {
    await Bun.write(
      join(root, "m3/templates/stack.toml"),
      [
        "[template.base]",
        'path = "m3/templates/base"',
        'description = "Base server"',
        "required = true",
        'dependencies = { "a" = "1.0.0" }',
        'dev_dependencies = { "b" = "2.0.0" }',
        "",
        "[template.hono]",
        'path = "m3/templates/hono"',
        'exclusive = "framework"',
        "",
        "[template.web]",
        'path = "m3/templates/web"',
        'curated = "default"',
      ].join("\n"),
    );
    await Bun.write(join(root, "m3/templates/base/src/server.ts"), "export {};\n");
    await Bun.write(join(root, "m3/templates/base/Dockerfile"), "FROM scratch\n");
    await Bun.write(join(root, "m3/templates/base/logo.png"), "binary");
    await Bun.write(join(root, "m3/templates/base/big.json"), "x".repeat(64 * 1024 + 1));
    await Bun.write(join(root, "m3/templates/hono/app.ts"), "export {};\n");
    await Bun.write(join(root, "m3/templates/web/index.html"), "<html></html>\n");

    const templates = await loadTemplates(root);
    const byId = Object.fromEntries(templates.map(t => [t.id, t]));

    expect(templates.map(t => t.id)).toEqual(["base", "hono", "web"]);
    expect(byId.base.cliCommand).toBe("just yolo::create ../my-app");
    expect(byId.hono.cliCommand).toBe("just yolo::create ../my-app --framework hono");
    expect(byId.web.cliCommand).toBe("just yolo::create ../my-app --with web");
    expect(byId.base.tags).toEqual(["required"]);
    expect(byId.hono.tags).toEqual(["exclusive: framework"]);
    expect(byId.web.tags).toEqual(["default"]);
    expect(byId.base.dependencies).toEqual({ a: "1.0.0", b: "2.0.0" });
    expect(byId.base.files.map(f => [f.path, f.language])).toEqual([
      ["Dockerfile", "text"],
      ["src/server.ts", "typescript"],
    ]);
    expect(byId.web.files[0]).toEqual({
      name: "index.html",
      path: "index.html",
      language: "html",
      content: "<html></html>\n",
    });
  });
});
