// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { mkdir, readdir, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { m3Plugin, M3_MODULES, fontsCss } from "../src/plugin.ts";
import { dataUrlFor, mimeFor, urlImportForm } from "../src/url-imports.ts";
import {
  findNativeTheme,
  nativeThemeMatches,
  readNativeTheme,
  type NativeThemeExport,
} from "../src/native.ts";
import { FIXTURE, fakeCss, REPO_ROOT, tempDir } from "./helpers.ts";

async function bundle(
  outdir: string,
  plugin: ReturnType<typeof m3Plugin>,
  entry = join(FIXTURE, "index.html"),
) {
  const result = await Bun.build({
    entrypoints: [entry],
    outdir,
    target: "browser",
    plugins: [plugin],
  });
  if (!result.success) throw new AggregateError(result.logs, "fixture build failed");
  const files = await readdir(outdir, { recursive: true });
  const read = async (ext: string) => {
    const name = files.find((file) => file.endsWith(ext));
    if (!name) throw new Error(`no ${ext} output in ${files.join(", ")}`);
    return Bun.file(join(outdir, name)).text();
  };
  return {
    files: files.map((f) => f.replaceAll("\\", "/")),
    css: await read(".css"),
    js: await read(".js"),
  };
}

function exportedRoles(block: string) {
  return Object.fromEntries(
    [...block.matchAll(/--md-sys-color-([a-z-]+):\s*(#[0-9a-f]{3}(?:[0-9a-f]{3})?);/g)].map(
      ([, role, color]) => [
        role!.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()),
        color!.length === 4
          ? `#${color!
              .slice(1)
              .split("")
              .map((c) => c + c)
              .join("")}`
          : color!,
      ],
    ),
  );
}

/** The fixture reuses the committed Rust golden CSS, never a JS color generator. */
async function nativeArtifact(dir: string) {
  const css = await Bun.file(
    Bun.resolveSync("@aphrody/m3-theme/tokens.css", import.meta.dir),
  ).text();
  const theme: NativeThemeExport = {
    schema_version: 1,
    spec_version: "2021",
    seed: "#6750a4",
    variant: "tonal-spot",
    contrast_level: 0,
    light: exportedRoles(/:root\s*\{([^}]+)\}/.exec(css)![1]!),
    dark: exportedRoles(/:root\.dark\s*,\s*\.dark\s*\{([^}]+)\}/.exec(css)![1]!),
  };
  const path = join(dir, "tokens.json");
  await Bun.write(path, JSON.stringify(theme));
  await Bun.write(join(dir, "tokens.css"), css);
  return { path, theme, css };
}

describe("native ThemeExport artifacts", () => {
  test("Bun's CSS compiler emits the canonical Rust roles through m3:tokens.css", async () => {
    await using tmp = await tempDir();
    const artifact = await nativeArtifact(tmp.dir);
    const entry = join(tmp.dir, "entry.ts");
    await Bun.write(entry, 'import "m3:tokens.css";\n');
    const result = await Bun.build({
      entrypoints: [entry],
      outdir: join(tmp.dir, "out"),
      target: "browser",
      plugins: [
        m3Plugin({
          nativeTheme: artifact.path,
          theme: { seed: "#6750A4", variant: "tonalSpot", dark: true },
          tailwind: false,
          sass: false,
        }),
      ],
    });
    expect(result.success).toBe(true);
    const css = await result.outputs.find((o) => o.path.endsWith(".css"))!.text();
    expect(css).toContain(`--md-sys-color-primary: ${artifact.theme.light.primary}`);
    expect(css).toContain(`--md-sys-color-primary: ${artifact.theme.dark.primary}`);
    expect(css).toContain("prefers-color-scheme: dark");
    expect(css).toContain("--primary: var(--md-sys-color-primary)");
    expect(readNativeTheme(artifact.path).css).toBe(artifact.css);
  });

  test("without Tailwind the Rust sheets reach Bun's CSS parser as plain CSS", async () => {
    await using tmp = await tempDir();
    const artifact = await nativeArtifact(tmp.dir);
    expect(artifact.css).toContain("@theme inline {");
    const entry = join(tmp.dir, "entry.ts");
    await Bun.write(entry, 'import "m3:tokens.css";\nimport "m3:tailwind.css";\n');
    const custom = (config: { sheet: string }) =>
      config.sheet === "tailwind"
        ? '@theme {\n  --color-*: initial;\n  --font-display: "Google Sans Flex";\n  @keyframes m3-spin { to { rotate: 1turn; } }\n}\n@theme inline reference { --color-x: red; }\n'
        : artifact.css;
    const result = await Bun.build({
      entrypoints: [entry],
      outdir: join(tmp.dir, "out"),
      target: "browser",
      plugins: [m3Plugin({ css: custom, theme: {}, tailwind: false, sass: false })],
    });
    expect(result.logs.map(String)).toEqual([]);
    expect(result.success).toBe(true);
    const css = await result.outputs.find((o) => o.path.endsWith(".css"))!.text();
    expect(css).not.toContain("@theme");
    expect(css).not.toContain("--color-primary:");
    expect(css).not.toContain("--color-x");
    expect(css).not.toContain("--color-*");
    expect(css).toMatch(/:root,\s*:host\s*\{\s*--font-display: "Google Sans Flex";?\s*\}/);
    expect(css).toContain("@keyframes m3-spin");
    expect(css).toContain(`--md-sys-color-primary: ${artifact.theme.light.primary}`);
    expect(css).toContain("--primary: var(--md-sys-color-primary)");
  });

  test("explicit mismatches fail the real build rather than emitting another seed's theme", async () => {
    await using tmp = await tempDir();
    const artifact = await nativeArtifact(tmp.dir);
    const entry = join(tmp.dir, "entry.ts");
    await Bun.write(entry, 'import "m3:theme.css";\n');
    await Promise.all(
      [{ seed: "#336699" }, { variant: "vibrant" }, { contrast: 1 }].map(async (theme, index) => {
        const result = await Bun.build({
          entrypoints: [entry],
          outdir: join(tmp.dir, `out-${index}`),
          plugins: [m3Plugin({ nativeTheme: artifact.path, theme, tailwind: false, sass: false })],
          throw: false,
        });
        expect(result.success).toBe(false);
        expect(result.logs.map(String).join("\n")).toContain("does not match");
      }),
    );
  });

  test("automatic discovery walks the selected project, and preserves explicit CSS generators", async () => {
    await using tmp = await tempDir();
    const corpus = join(tmp.dir, "var/mirrors/design-sync");
    const artifact = await nativeArtifact(corpus);
    const nested = join(tmp.dir, "project/src");
    await mkdir(nested, { recursive: true });
    // An explicit caller-owned artifact has deterministic precedence over environment discovery.
    expect(findNativeTheme(nested)).toBe(
      process.env.APHRODY_DESIGN_CORPUS
        ? join(process.env.APHRODY_DESIGN_CORPUS, "tokens.json")
        : artifact.path,
    );
    const generator = fakeCss();
    const entry = join(tmp.dir, "entry.ts");
    await Bun.write(entry, 'import "m3:theme.css";\n');
    const result = await Bun.build({
      entrypoints: [entry],
      outdir: join(tmp.dir, "out"),
      plugins: [
        m3Plugin({
          nativeTheme: artifact.path,
          theme: { seed: "#336699" },
          css: generator.css,
          tailwind: false,
          sass: false,
        }),
      ],
    });
    expect(result.success).toBe(true);
    expect(generator.calls).toEqual([{ sheet: "tokens", seed: "#336699" }]);
  });

  test("only matching token requests can reuse an export", async () => {
    await using tmp = await tempDir();
    const { theme } = await nativeArtifact(tmp.dir);
    expect(nativeThemeMatches({ sheet: "tokens" }, theme)).toBe(true);
    expect(nativeThemeMatches({ sheet: "scheme" }, theme)).toBe(false);
    expect(nativeThemeMatches({ sheet: "tokens", seed: "#336699" }, theme)).toBe(false);
    expect(nativeThemeMatches({ sheet: "tokens", contrast: Number.NaN }, theme)).toBe(false);
    expect(nativeThemeMatches({ sheet: "tokens", variant: "tonal_spot", dark: true }, theme)).toBe(
      true,
    );
  });

  test("schema, color spec, roles and both CSS modes are verified", async () => {
    await using tmp = await tempDir();
    const artifact = await nativeArtifact(tmp.dir);
    for (const invalid of [
      { ...artifact.theme, schema_version: 2 },
      { ...artifact.theme, spec_version: "2025" },
      { ...artifact.theme, contrast_level: 2 },
      { ...artifact.theme, seed: "#000000" },
      { ...artifact.theme, light: { ...artifact.theme.light, primary: "red" } },
      { ...artifact.theme, dark: { ...artifact.theme.dark, unexpected: "#000000" } },
    ]) {
      // eslint-disable-next-line no-await-in-loop -- Each invalid mutation must be read before the next overwrite.
      await Bun.write(artifact.path, JSON.stringify(invalid));
      expect(() => readNativeTheme(artifact.path)).toThrow("invalid native theme artifact");
    }
    await Bun.write(artifact.path, JSON.stringify(artifact.theme));
    await Bun.write(
      join(tmp.dir, "tokens.css"),
      artifact.css.replace(
        `--md-sys-color-primary: ${artifact.theme.light.primary}`,
        "--md-sys-color-primary: #000000",
      ),
    );
    expect(() => readNativeTheme(artifact.path)).toThrow("JSON/CSS role values differ");
    await Bun.write(join(tmp.dir, "tokens.css"), artifact.css.replace(":root.dark", ":root.other"));
    expect(() => readNativeTheme(artifact.path)).toThrow("missing dark CSS block");
  });

  test("large files, symlinks and junction ancestors are rejected", async () => {
    await using tmp = await tempDir();
    const artifact = await nativeArtifact(tmp.dir);
    await Bun.write(artifact.path, " ".repeat(1024 * 1024 + 1));
    expect(() => readNativeTheme(artifact.path)).toThrow("at most 1048576 bytes");
    await nativeArtifact(tmp.dir);
    const link = join(tmp.dir, "linked");
    await symlink(tmp.dir, link, process.platform === "win32" ? "junction" : "dir");
    expect(() => readNativeTheme(join(link, "tokens.json"))).toThrow("symbolic link");
  });
});

const liveNativeTheme = findNativeTheme(process.cwd());
describe.skipIf(!liveNativeTheme)("live native design-sync exports", () => {
  test("automatic corpus discovery compiles all 49 pet roles in each mode", async () => {
    await using tmp = await tempDir();
    const { theme } = readNativeTheme(liveNativeTheme!);
    const entry = join(tmp.dir, "entry.ts");
    await Bun.write(entry, 'import "m3:tokens.css";\n');
    const result = await Bun.build({
      entrypoints: [entry],
      outdir: join(tmp.dir, "out"),
      target: "browser",
      plugins: [
        m3Plugin({
          configDir: dirname(liveNativeTheme!),
          theme: { seed: theme.seed, variant: theme.variant, contrast: theme.contrast_level },
          tailwind: false,
          sass: false,
        }),
      ],
    });
    expect(result.success).toBe(true);
    const css = await result.outputs.find((o) => o.path.endsWith(".css"))!.text();
    // Bun legally shortens #ffffff to #fff; compare all roles after hex syntax normalization.
    expect(exportedRoles(/:root\s*\{([^}]+)\}/.exec(css)![1]!)).toEqual(theme.light);
    expect(exportedRoles(/:root\.dark\s*,\s*\.dark\s*\{([^}]+)\}/.exec(css)![1]!)).toEqual(
      theme.dark,
    );
    expect(css).toContain("prefers-color-scheme: dark");
  });

  test.skipIf(
    !liveNativeTheme ||
      !existsSync(liveNativeTheme.replace(/tokens\.json$/, "tokens-high-contrast.json")),
  )(
    "native high-contrast export is distinct and a standard export cannot fulfill that request",
    async () => {
      await using tmp = await tempDir();
      const standard = readNativeTheme(liveNativeTheme!);
      const highPath = liveNativeTheme!.replace(/tokens\.json$/, "tokens-high-contrast.json");
      const high = readNativeTheme(highPath);
      expect(high.theme.contrast_level).toBe(1);
      expect(high.theme.light.primary).not.toBe(standard.theme.light.primary);
      expect(high.theme.dark.primary).not.toBe(standard.theme.dark.primary);
      const entry = join(tmp.dir, "entry.ts");
      await Bun.write(entry, 'import "m3:tokens.css";\n');
      const request = { seed: high.theme.seed, variant: high.theme.variant, contrast: 1 };
      const accepted = await Bun.build({
        entrypoints: [entry],
        outdir: join(tmp.dir, "high"),
        plugins: [
          m3Plugin({ nativeTheme: highPath, theme: request, tailwind: false, sass: false }),
        ],
      });
      expect(accepted.success).toBe(true);
      const css = await accepted.outputs.find((o) => o.path.endsWith(".css"))!.text();
      expect(css).toContain(`--md-sys-color-primary: ${high.theme.light.primary}`);
      expect(css).toContain(`--md-sys-color-primary: ${high.theme.dark.primary}`);
      const rejected = await Bun.build({
        entrypoints: [entry],
        outdir: join(tmp.dir, "invalid"),
        plugins: [
          m3Plugin({ nativeTheme: liveNativeTheme!, theme: request, tailwind: false, sass: false }),
        ],
        throw: false,
      });
      expect(rejected.success).toBe(false);
      expect(rejected.logs.map(String).join("\n")).toContain("does not match");
    },
  );
});

describe("m3Plugin virtual modules", () => {
  test("m3:theme.css is the tokens sheet of the configured theme", async () => {
    await using tmp = await tempDir();
    const { css, calls } = fakeCss();
    const theme = { seed: "#abcdef", variant: "expressive", contrast: 0.5 };
    const out = await bundle(tmp.dir, m3Plugin({ css, theme, root: REPO_ROOT }));
    expect(calls).toEqual([
      { sheet: "tokens", seed: "#abcdef", variant: "expressive", contrast: 0.5 },
    ]);
    expect(out.css).toContain("--fixture-primary: #123456");
    expect(out.css).toContain("expressive");
  });

  test("the theme defaults to m3.config.ts of configDir", async () => {
    await using tmp = await tempDir();
    const { css, calls } = fakeCss();
    await bundle(tmp.dir, m3Plugin({ css, configDir: FIXTURE, root: REPO_ROOT }));
    expect(calls).toEqual([
      { sheet: "tokens", seed: "#336699", variant: "vibrant", contrast: 0.5 },
    ]);
  });

  test("the generator runs once per sheet and build", async () => {
    await using tmp = await tempDir();
    const { css, calls } = fakeCss();
    const entry = join(tmp.dir, "entry.ts");
    await Bun.write(
      entry,
      'import "m3:theme.css";\nimport "m3:tokens.css";\nimport "m3:tailwind.css";\n',
    );
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
