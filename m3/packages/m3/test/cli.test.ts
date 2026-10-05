// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { existsSync, statSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { buildM3 } from "../src/build.ts";
import {
  bunfigHasPlugin,
  findWorkspaceRoot,
  parseArgs,
  runCli,
  sheetFlag,
  version,
} from "../src/cli.ts";
import { BUNDLE_FILES, writeTokenBundle } from "../src/tokens.ts";
import { FIXTURE, fakeCss, REPO_ROOT, tempDir } from "./helpers.ts";

describe("parseArgs", () => {
  test("commands, values, booleans and negations", () => {
    expect(parseArgs(["dev", "--port", "4000", "--no-hmr"])).toEqual({
      command: "dev",
      flags: { port: "4000", hmr: false },
      positionals: [],
    });
    expect(
      parseArgs(["tokens", "--seed=#ff0000", "--dark", "--sheet", "scheme", "-o", "out.css"]).flags,
    ).toEqual({
      seed: "#ff0000",
      dark: true,
      sheet: "scheme",
      out: "out.css",
    });
    expect(parseArgs(["tokens", "--bundle", "dir", "--contrast", "-0.5"]).flags).toEqual({
      bundle: "dir",
      contrast: "-0.5",
    });
  });

  test("--tauri takes an optional directory", () => {
    expect(parseArgs(["build", "--tauri"]).flags).toEqual({ tauri: true });
    expect(parseArgs(["build", "--tauri", "--dev"]).flags).toEqual({ tauri: true, dev: true });
    expect(parseArgs(["build", "--tauri", "../ui-dist"]).flags).toEqual({ tauri: "../ui-dist" });
  });

  test("help, version, errors and positionals", () => {
    expect(parseArgs([]).command).toBe("help");
    expect(parseArgs(["build", "-h"]).command).toBe("help");
    expect(parseArgs(["--version"]).command).toBe("version");
    expect(parseArgs(["check", "extra", "--", "--raw"]).positionals).toEqual(["extra", "--raw"]);
    expect(() => parseArgs(["deploy"])).toThrow("unknown command deploy");
    expect(() => parseArgs(["dev", "--port"])).toThrow("--port needs a value");
  });

  test("compile and desktop commands parsing", () => {
    expect(parseArgs(["compile", "--outfile", "dist/app", "--dev"])).toEqual({
      command: "compile",
      flags: { outfile: "dist/app", dev: true },
      positionals: [],
    });
    expect(parseArgs(["desktop", "--dev"])).toEqual({
      command: "desktop",
      flags: { dev: true },
      positionals: [],
    });
    expect(parseArgs(["desktop", "--build"])).toEqual({
      command: "desktop",
      flags: { build: true },
      positionals: [],
    });
  });

  test("--sheet validation", () => {
    expect(sheetFlag({})).toBe("tokens");
    expect(sheetFlag({ sheet: "spaceui" })).toBe("spaceui");
    expect(() => sheetFlag({ sheet: "nope" })).toThrow("--sheet must be one of");
  });
});

describe("runCli", () => {
  test("m3 build --tauri <dir> on the fixture app", async () => {
    await using tmp = await tempDir();
    const uiDist = join(tmp.dir, "ui");
    // m3.plain.config.ts: the fixture without m3:theme.css (the CLI takes no generator injection).
    expect(
      await runCli(["build", "--tauri", uiDist, "--config", "m3.plain.config.ts"], FIXTURE),
    ).toBe(0);
    expect((await readdir(uiDist)).toSorted()).toEqual([
      "app.css",
      "app.js",
      "fonts",
      "index.html",
    ]);
    // plain.html became index.html.
    expect(await Bun.file(join(uiDist, "index.html")).text()).toContain('src="./app.js"');
  });

  test("m3 build --tauri without a directory needs tauri.uiDist", async () => {
    await using tmp = await tempDir();
    await Bun.write(join(tmp.dir, "m3.config.ts"), 'export default { entry: "index.html" };\n');
    await expect(runCli(["build", "--tauri"], tmp.dir)).rejects.toThrow("tauri.uiDist");
  });

  test("help and version", async () => {
    expect(await runCli(["help"])).toBe(0);
    expect(await version()).toBe(
      (await Bun.file(join(import.meta.dir, "../package.json")).json()).version,
    );
  });

  test("workspace discovery and bunfig detection", async () => {
    await using tmp = await tempDir();
    // The workspace root is the nearest package.json declaring `bun:check`, wherever the checkout is.
    await Bun.write(
      join(tmp.dir, "package.json"),
      JSON.stringify({ scripts: { "bun:check": "true" } }),
    );
    await Bun.write(join(tmp.dir, "apps/app/package.json"), JSON.stringify({ name: "app" }));
    expect(findWorkspaceRoot(join(tmp.dir, "apps/app"))).toBe(tmp.dir);
    expect(
      findWorkspaceRoot(FIXTURE) === undefined ||
        existsSync(join(findWorkspaceRoot(FIXTURE)!, "package.json")),
    ).toBe(true);
    expect(await bunfigHasPlugin(tmp.dir)).toBe(false);
    await Bun.write(
      join(tmp.dir, "bunfig.toml"),
      '[serve.static]\nplugins = ["@aphrody/m3/plugin"]\n',
    );
    expect(await bunfigHasPlugin(tmp.dir)).toBe(true);
  });

  test("m3 new refuses an external project before creating any directory", async () => {
    await using tmp = await tempDir();
    const project = join(tmp.dir, "absent", "my-app");
    await expect(runCli(["new", project], REPO_ROOT)).rejects.toThrow(
      "Aphrody/M3 private owner workspace required",
    );
    expect(existsSync(join(tmp.dir, "absent"))).toBe(false);
  });

  test("m3 new scaffolds an M3 app in its private owner and refuses to overwrite it", async () => {
    const name = `m3-migrate-contract-cli-${crypto.randomUUID()}`;
    const relativeProject = `apps/${name}`;
    const project = join(REPO_ROOT, relativeProject);
    try {
      expect(await runCli(["new", relativeProject], REPO_ROOT)).toBe(0);
      const manifest = await Bun.file(join(project, "package.json")).json();
      expect(manifest).toMatchObject({
        name,
        private: true,
        scripts: { dev: "m3 dev", build: "m3 build" },
        dependencies: { "@aphrody/m3": "workspace:*" },
      });
      expect(await Bun.file(join(project, "bunfig.toml")).text()).toContain('"@aphrody/m3/plugin"');
      expect(await Bun.file(join(project, "m3.config.ts")).text()).toContain('entry: "index.html"');
      expect(await Bun.file(join(project, "index.html")).text()).toContain("./src/main.ts");
      expect(await Bun.file(join(project, "src/main.ts")).text()).toContain("m3:theme.css");
      // Build the generated app; native FFI parity is separately covered by native.test.ts.
      const built = await buildM3({
        entry: join(project, "index.html"),
        outdir: join(project, "dist"),
        cwd: project,
        plugin: { css: fakeCss().css, root: REPO_ROOT },
      });
      expect(built.outputs.some((output) => output.path === "index.html")).toBe(true);
      await expect(runCli(["new", relativeProject], REPO_ROOT)).rejects.toThrow();
      expect((await Bun.file(join(project, "package.json")).json()).name).toBe(name);
      await expect(runCli(["new"], REPO_ROOT)).rejects.toThrow("expected one project directory");
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  test("m3 compile writes an executable, not an HTML file, and the executable serves the built UI", async () => {
    await using tmp = await tempDir();
    const outfile = join(tmp.dir, "test-bin");
    expect(
      await runCli(["compile", "--outfile", outfile, "--config", "m3.plain.config.ts"], FIXTURE),
    ).toBe(0);
    expect(existsSync(outfile)).toBe(true);

    // An executable of this platform (ELF, PE or Mach-O), carrying the Bun runtime: the old output was ~130 KB of HTML.
    const magic = [...new Uint8Array(await Bun.file(outfile).slice(0, 4).arrayBuffer())];
    const native =
      process.platform === "win32"
        ? [0x4d, 0x5a]
        : process.platform === "darwin"
          ? [0xcf, 0xfa, 0xed, 0xfe]
          : [0x7f, 0x45, 0x4c, 0x46];
    expect(magic.slice(0, native.length)).toEqual(native);
    expect(statSync(outfile).size).toBeGreaterThan(10_000_000);
    if (process.platform !== "win32") expect(statSync(outfile).mode & 0o111).not.toBe(0);

    const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
    const port = probe.port;
    await probe.stop(true);
    const server = Bun.spawn([outfile], {
      env: { ...process.env, PORT: String(port) },
      stdout: "ignore",
      stderr: "ignore",
    });
    try {
      let page: Response | undefined;
      // Readiness polling is sequential: each failed probe determines whether another is needed.
      /* oxlint-disable no-await-in-loop */
      for (let i = 0; i < 100 && !page; i++) {
        page = await fetch(`http://127.0.0.1:${port}/`).catch(() => undefined);
        if (!page) await Bun.sleep(50);
      }
      /* oxlint-enable no-await-in-loop */
      expect(page?.status).toBe(200);
      expect(page?.headers.get("content-type")).toStartWith("text/html");
      expect(await page!.text()).toContain("<title>m3 fixture</title>");
      expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
    } finally {
      server.kill();
      await server.exited;
    }
  }, 60_000);

  test("m3 desktop requires tauri config and builds webview", async () => {
    await using tmp = await tempDir();
    await Bun.write(join(tmp.dir, "m3.config.ts"), 'export default { entry: "index.html" };\n');
    await expect(runCli(["desktop"], tmp.dir)).rejects.toThrow("tauri.uiDist");

    const uiDist = join(tmp.dir, "desktop-ui");
    await Bun.write(
      join(tmp.dir, "m3.config.ts"),
      `export default { entry: "${join(FIXTURE, "plain.html")}", tauri: { uiDist: "${uiDist}" } };\n`,
    );
    expect(await runCli(["desktop"], tmp.dir)).toBe(0);
    expect(existsSync(join(uiDist, "index.html"))).toBe(true);
  });
});

describe("token bundle", () => {
  test("writes every sheet, both schemes, the fonts and a manifest", async () => {
    await using tmp = await tempDir();
    const { css, calls } = fakeCss();
    const files = await writeTokenBundle(tmp.dir, { css, seed: "#00ff00", root: REPO_ROOT });
    expect(files).toEqual([...BUNDLE_FILES]);
    for (const file of files) expect(existsSync(join(tmp.dir, file))).toBe(true);
    expect(calls).toEqual([
      { sheet: "tokens", seed: "#00ff00" },
      { sheet: "tailwind", seed: "#00ff00" },
      { sheet: "spaceui", seed: "#00ff00" },
      { sheet: "scheme", seed: "#00ff00", dark: false },
      { sheet: "scheme", seed: "#00ff00", dark: true },
    ]);
    const fonts = await Bun.file(join(tmp.dir, "fonts.css")).text();
    expect(fonts).toContain('url("./fonts/material-symbols-rounded.woff2")');
    expect(fonts).toContain('url("./fonts/GoogleSansFlex-Variable.ttf")');
    const manifest = await Bun.file(join(tmp.dir, "manifest.json")).json();
    expect(manifest.theme).toEqual({ seed: "#00ff00" });
  });
});
