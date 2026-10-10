// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createApp, createTemplates } from "../src/tools-create.ts";
import { cleanup, tmp } from "./helpers.ts";

afterAll(cleanup);

describe("createApp", () => {
  test("offers the templates of @aphrody/scaffold", async () => {
    expect((await createTemplates()).map(template => template.name)).toEqual(["web", "app", "spa", "example"]);
  });

  test("a dry run lists the rendered files and names the package after the directory", async () => {
    const dir = join(tmp("m3-bun-create-"), "My App");
    const report = await createApp({ template: "web", dir, dryRun: true });
    expect(report).toMatchObject({ template: "web", name: "my-app", written: false });
    expect(report.files).toEqual([
      ".gitignore",
      "bunfig.toml",
      "index.html",
      "m3.config.ts",
      "package.json",
      "src/main.ts",
    ]);
    expect((await createApp({ template: "app", dir, name: "demo", dryRun: true })).files).toEqual(
      expect.arrayContaining(["m3.config.ts", "package.json", "src/App.tsx", "src/index.html"]),
    );
    expect(existsSync(dir)).toBe(false);
  });

  test("writing keeps the scaffolder's guard: only a declared member of the workspace", async () => {
    const dir = join(tmp("m3-bun-create-"), "outside");
    await expect(createApp({ template: "spa", dir })).rejects.toThrow(/private owner workspace required/);
    expect(existsSync(dir)).toBe(false);
  });

  test("an unknown template is an error that lists the templates", async () => {
    await expect(createApp({ template: "nope" as never, dir: tmp(), dryRun: true })).rejects.toThrow(
      /unknown template nope \(web, app, spa, example\)/,
    );
  });
});
