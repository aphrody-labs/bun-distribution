// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  COMPILE_TARGETS,
  compileTarget,
  defineM3Bun,
  findWorkspaceRoot,
  loadApp,
} from "../src/config.ts";
import { slug } from "../src/util.ts";
import { cleanup, fixtureCopy, FIXTURE } from "./helpers.ts";

afterAll(cleanup);

describe("loadApp", () => {
  test("derives name, version, port, paths and the minify default from the fixture", async () => {
    const app = await loadApp(FIXTURE);
    expect(app.name).toBe("hello-m3");
    expect(app.version).toBe("1.2.3");
    expect(app.port).toBe(3456);
    expect(app.api).toBe(join(FIXTURE, "src/api.ts"));
    expect(app.outdir).toBe(join(FIXTURE, "dist"));
    expect(app.minify).toBe("full");
    expect(app.m3.entry).toBe(join(FIXTURE, "src/index.html"));
    expect(app.bun.deploy?.domain).toBe("hello.example.com");
  });

  test("an app without a `bun` export still loads, with defaults", async () => {
    const dir = fixtureCopy();
    await Bun.write(
      join(dir, "m3.config.ts"),
      'import { defineM3Config } from "@aphrody/m3/config";\nexport default defineM3Config({ entry: "src/index.html", port: 4001 });\n',
    );
    const app = await loadApp(dir);
    expect(app.api).toBeUndefined();
    expect(app.port).toBe(4001);
    expect(app.bun).toEqual({});
  });

  test("a bad minify level and a missing api module are errors", async () => {
    const dir = fixtureCopy();
    await Bun.write(
      join(dir, "m3.config.ts"),
      'import { defineM3Config } from "@aphrody/m3/config";\nexport default defineM3Config({ entry: "src/index.html" });\nexport const bun = { minify: "extreme" };\n',
    );
    await expect(loadApp(dir)).rejects.toThrow(/minify must be none, basic or full/);
    await Bun.write(
      join(dir, "m3.config.ts"),
      'import { defineM3Config } from "@aphrody/m3/config";\nexport default defineM3Config({ entry: "src/index.html" });\nexport const bun = { api: "src/nope.ts" };\n',
    );
    await expect(loadApp(dir)).rejects.toThrow(/api module not found/);
  });
});

test("an embedded module uses its product identity without another package manifest", async () => {
  const dir = fixtureCopy();
  await Bun.write(
    join(dir, "m3.config.ts"),
    'import { defineM3Config } from "@aphrody/m3/config";\nexport default defineM3Config({ entry: "src/index.html" });\nexport const bun = { name: "embedded-module", version: "4.5.6" };\n',
  );
  const app = await loadApp(dir);
  expect(app.name).toBe("embedded-module");
  expect(app.version).toBe("4.5.6");
});

describe("helpers", () => {
  test("slug makes DNS-safe names", () => {
    expect(slug("@aphrody/m3-showcase")).toBe("m3-showcase");
    expect(slug("My App_2!")).toBe("my-app-2");
    expect(slug("___")).toBe("app");
  });
  test("compile targets map to bun-<name>; unknown names throw", () => {
    expect(compileTarget("linux-x64-musl")).toBe("bun-linux-x64-musl");
    expect(compileTarget(undefined)).toBeUndefined();
    expect(() => compileTarget("plan9-x64" as never)).toThrow(/unknown compile target/);
    expect(COMPILE_TARGETS).toContain("windows-x64");
  });
  test("defineM3Bun is the identity and findWorkspaceRoot finds the monorepo", () => {
    const config = { port: 1 };
    expect(defineM3Bun(config)).toBe(config);
    expect(findWorkspaceRoot(FIXTURE)).toBe(join(import.meta.dir, "../../../.."));
    expect(findWorkspaceRoot("/")).toBeUndefined();
  });
});
