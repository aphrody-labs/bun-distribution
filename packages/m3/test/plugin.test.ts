// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { m3Plugin, M3_MODULES, fontsCss } from "../src/plugin.ts";
import { dataUrlFor, mimeFor, urlImportForm } from "../src/url-imports.ts";
import { FIXTURE, fakeCss, REPO_ROOT, tempDir } from "./helpers.ts";

async function bundle(outdir: string, plugin: ReturnType<typeof m3Plugin>, entry = join(FIXTURE, "index.html")) {
  const result = await Bun.build({ entrypoints: [entry], outdir, target: "browser", plugins: [plugin] });
  if (!result.success) throw new AggregateError(result.logs, "fixture build failed");
  const files = await readdir(outdir, { recursive: true });
  const read = async (ext: string) => {
    const name = files.find((file) => file.endsWith(ext));
    if (!name) throw new Error(`no ${ext} output in ${files.join(", ")}`);
    return Bun.file(join(outdir, name)).text();
  };
  return { files: files.map((f) => f.replaceAll("\\", "/")), css: await read(".css"), js: await read(".js") };
}

describe("m3Plugin virtual modules", () => {
  test("m3:theme.css is the tokens sheet of the configured theme", async () => {
    await using tmp = await tempDir();
    const { css, calls } = fakeCss();
    const theme = { seed: "#abcdef", variant: "expressive", contrast: 0.5 };
    const out = await bundle(tmp.dir, m3Plugin({ css, theme, root: REPO_ROOT }));
    expect(calls).toEqual([{ sheet: "tokens", seed: "#abcdef", variant: "expressive", contrast: 0.5 }]);
    expect(out.css).toContain("--fixture-primary: #123456");
    expect(out.css).toContain("expressive");
  });

  test("the theme defaults to m3.config.ts of configDir", async () => {
    await using tmp = await tempDir();
    const { css, calls } = fakeCss();
    await bundle(tmp.dir, m3Plugin({ css, configDir: FIXTURE, root: REPO_ROOT }));
    expect(calls).toEqual([{ sheet: "tokens", seed: "#336699", variant: "vibrant", contrast: 0.5 }]);
  });

  test("the generator runs once per sheet and build", async () => {
    await using tmp = await tempDir();
    const { css, calls } = fakeCss();
    const entry = join(tmp.dir, "entry.ts");
    await Bun.write(entry, 'import "m3:theme.css";\nimport "m3:tokens.css";\nimport "m3:tailwind.css";\n');
    const result = await Bun.build({
      entrypoints: [entry],
      outdir: join(tmp.dir, "out"),
      plugins: [m3Plugin({ css, theme: {}, root: REPO_ROOT, tailwind: false })],
    });
    expect(result.success).toBe(true);
    expect(calls.map((c) => c.sheet).toSorted()).toEqual(["tailwind", "tokens"]);
  });

  test("m3:symbols.css and m3:fonts.css ship the crate fonts as assets", async () => {
    await using tmp = await tempDir();
    const out = await bundle(tmp.dir, m3Plugin({ css: fakeCss().css, theme: {}, root: REPO_ROOT }));
    expect(out.files.some((f) => /material-symbols-outlined.*\.woff2$/.test(f))).toBe(true);
    expect(out.files.some((f) => /GoogleSansFlex-Variable.*\.ttf$/.test(f))).toBe(true);
    expect(out.css).toMatch(/font-family: "?Material Symbols Outlined"?/);
    expect(out.css).toMatch(/font-family: "?Google Sans Flex"?/);
    expect(out.css).toContain(".material-symbols-outlined");
  });

  test("Tailwind v4 is composed: utilities from the HTML are generated", async () => {
    await using tmp = await tempDir();
    const out = await bundle(tmp.dir, m3Plugin({ css: fakeCss().css, theme: {}, root: REPO_ROOT }));
    expect(out.css).toContain(".bg-primary");
    expect(out.css).toContain(".p-4");
  });

  test("an unknown m3: module fails the build with the list of known ones", async () => {
    await using tmp = await tempDir();
    const entry = join(tmp.dir, "entry.ts");
    await Bun.write(entry, 'import "m3:nope.css";\n');
    const result = await Bun.build({
      entrypoints: [entry],
      outdir: join(tmp.dir, "out"),
      plugins: [m3Plugin({ css: fakeCss().css, root: REPO_ROOT, tailwind: false })],
      throw: false,
    });
    expect(result.success).toBe(false);
    expect(result.logs.map(String).join("\n")).toContain("m3:symbols.css");
  });

  test("fonts.css declares the variable axes", () => {
    expect(fontsCss()).toContain('url("./GoogleSansFlex-Variable.ttf")');
    expect(M3_MODULES).toContain("m3:theme.css");
    expect(M3_MODULES).toContain("m3:fonts.css");
  });
});

describe("?url imports", () => {
  test(".svg is emitted as a file; other assets are inlined; .scss line comments are stripped", async () => {
    await using tmp = await tempDir();
    const out = await bundle(tmp.dir, m3Plugin({ css: fakeCss().css, theme: {}, root: REPO_ROOT }));
    expect(out.files.some((file) => /^logo(-[a-z0-9]+)?\.svg$/.test(file))).toBe(true);
    expect(out.js).not.toContain("data:image/svg+xml");
    expect(urlImportForm("a.SVG")).toBe("file");
    expect(urlImportForm("a.png")).toBe("inline");
    const scss = await dataUrlFor(join(FIXTURE, "prism.scss"));
    const decoded = Buffer.from(scss.split(",")[1]!, "base64").toString("utf8");
    expect(decoded).not.toContain("line comment");
    expect(decoded).toContain("#abcdef");
    expect(out.js).toContain(scss);
  });

  test("mime types", () => {
    expect(mimeFor("a.svg")).toBe("image/svg+xml");
    expect(mimeFor("a.SCSS")).toBe("text/css");
    expect(mimeFor("a.woff2")).toBe("font/woff2");
    expect(mimeFor("a.bin")).toBe("application/octet-stream");
  });
});
