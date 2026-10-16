// SPDX-License-Identifier: Apache-2.0
// The plugins m3Bun composes, through real `Bun.build` runs. A package resolves from the app directory (`configDir`)
// then from @aphrody/m3-bun; `M3_BUN_TEST_DEPS` (path list) adds directories where packages not yet in
// @aphrody/m3-bun's dependencies are installed. A suite whose packages resolve nowhere is skipped.
import { afterAll, describe, expect, test } from "bun:test";
import { delimiter, dirname, join } from "node:path";
import type { BuildConfig, BunPlugin } from "bun";
import { m3Bun } from "../src/plugin.ts";
import { lazyPlugin, M3_OPTIMIZE_IMPORTS, m3OptimizeImports, resolveFrom } from "../src/plugins.ts";
import { cleanup, tmp } from "./helpers.ts";

afterAll(cleanup);

const DEP_DIRS = [dirname(import.meta.dir), ...(Bun.env.M3_BUN_TEST_DEPS?.split(delimiter).filter(Boolean) ?? [])];

/** The first directory every specifier resolves from. */
function depsFor(...specifiers: string[]): string | undefined {
  return DEP_DIRS.find(dir => specifiers.every(s => resolveFrom(s, [dir])));
}

async function write(files: Record<string, string>): Promise<string> {
  const dir = tmp();
  for (const [name, content] of Object.entries(files)) {
    // oxlint-disable-next-line no-await-in-loop -- Materialize each fixture file before the single bundler invocation.
    await Bun.write(join(dir, name), content);
  }
  return dir;
}

async function build(
  dir: string,
  entry: string,
  plugin: BunPlugin,
  config: Partial<BuildConfig> = {},
): Promise<{ success: boolean; logs: string; text: string }> {
  const result = await Bun.build({
    entrypoints: [join(dir, entry)],
    root: dir,
    target: "browser",
    plugins: [plugin],
    throw: false,
    ...config,
  } as BuildConfig);
  const text = (await Promise.all(result.outputs.map(o => o.text()))).join("\n");
  return { success: result.success, logs: result.logs.map(String).join("\n"), text };
}

describe("lazyPlugin", () => {
  test("imports the plugin on the first matching module only, then forwards to its hooks", async () => {
    let loads = 0;
    const plugin = lazyPlugin({
      name: "probe",
      load: async () => {
        loads++;
        return {
          name: "inner",
          setup(b) {
            b.onResolve({ filter: /^probe:/ }, args => ({ path: args.path, namespace: "probe" }));
            b.onLoad({ filter: /.*/, namespace: "probe" }, args => ({
              contents: `export default ${JSON.stringify(args.path)};`,
              loader: "js",
            }));
          },
        };
      },
      onResolve: [{ filter: /^probe:/ }],
      onLoad: [{ filter: /.*/, namespace: "probe" }],
    });
    const plain = await write({ "main.ts": "console.log(1);\n" });
    expect((await build(plain, "main.ts", plugin)).success).toBe(true);
    expect(loads).toBe(0);
    const used = await write({ "main.ts": 'import a from "probe:a"; import b from "probe:b"; console.log(a, b);\n' });
    const { success, text } = await build(used, "main.ts", plugin);
    expect(success).toBe(true);
    expect(text).toContain('"probe:a"');
    expect(text).toContain('"probe:b"');
    expect(loads).toBe(1);
  });

  test("a failing import is a build error", async () => {
    const plugin = lazyPlugin({
      name: "broken",
      load: () => Promise.reject(new Error("m3-bun: probe needs @nope/probe")),
      onLoad: [{ filter: /\.probe$/ }],
    });
    const dir = await write({ "main.ts": 'import "./x.probe";\n', "x.probe": "" });
    const { success, logs } = await build(dir, "main.ts", plugin);
    expect(success).toBe(false);
    expect(logs).toContain("m3-bun: probe needs @nope/probe");
  });
});

describe("optimizeImports", () => {
  test("the m3 barrels are listed once, the app's entries kept", () => {
    expect(m3OptimizeImports(["lodash-es", "@aphrody/m3-react"])).toEqual([...M3_OPTIMIZE_IMPORTS, "lodash-es"]);
  });

  test("Bun.build skips the unused submodules of an m3 barrel", async () => {
    const dir = await write({
      "node_modules/@aphrody/m3-react/package.json": '{ "name": "@aphrody/m3-react", "main": "index.ts" }\n',
      "node_modules/@aphrody/m3-react/index.ts":
        'export { Button } from "./button.ts";\nexport { Broken } from "./broken.ts";\n',
      "node_modules/@aphrody/m3-react/button.ts": 'export const Button = "m3-button";\n',
      "node_modules/@aphrody/m3-react/broken.ts": "export const Broken = ;\n",
      "main.ts": 'import { Button } from "@aphrody/m3-react";\nconsole.log(Button);\n',
    });
    const plain: BunPlugin = { name: "none", setup() {} };
    const without = await build(dir, "main.ts", plain);
    expect(without.success).toBe(false);
    const optimized = await build(dir, "main.ts", plain, { optimizeImports: m3OptimizeImports() });
    expect(optimized.logs).toBe("");
    expect(optimized.text).toContain("m3-button");
    expect(optimized.success).toBe(true);
  });
});

const yamlDeps = depsFor("@aphrody/bun-plugin-yaml");
describe.skipIf(!yamlDeps)("yaml: @aphrody/bun-plugin-yaml", () => {
  test("off by default: Bun's own YAML loader; on: js-yaml, which rejects duplicate keys", async () => {
    const dir = await write({ "data.yaml": "a: 1\nlist: [x, y]\n", "dup.yml": "a: 1\na: 2\n" });
    await Bun.write(join(dir, "main.ts"), 'import data from "./data.yaml"; console.log(data.list);\n');
    await Bun.write(join(dir, "dup.ts"), 'import dup from "./dup.yml"; console.log(dup);\n');
    const native = await build(dir, "dup.ts", m3Bun({ configDir: yamlDeps }));
    expect(native.success).toBe(true);
    const ok = await build(dir, "main.ts", m3Bun({ configDir: yamlDeps, yaml: true }));
    expect(ok.logs).toBe("");
    expect(ok.text).toContain('"x"');
    const dup = await build(dir, "dup.ts", m3Bun({ configDir: yamlDeps, yaml: true }));
    expect(dup.success).toBe(false);
    expect(dup.logs).toContain("duplicated mapping key");
  });
});

const svelteDeps = depsFor("@aphrody/bun-plugin-svelte", "svelte/compiler");
describe.skipIf(!svelteDeps)("svelte: @aphrody/bun-plugin-svelte", () => {
  test("on by default: components compile and their styles become a CSS output", async () => {
    const dir = await write({
      "Counter.svelte":
        "<script>let count = $state(0);</script>\n<button onclick={() => count++}>{count}</button>\n<style>button { color: rebeccapurple; }</style>\n",
      "main.ts": 'import Counter from "./Counter.svelte";\nconsole.log(Counter);\n',
    });
    const { success, logs, text } = await build(dir, "main.ts", m3Bun({ configDir: svelteDeps }), {
      external: ["svelte", "svelte/*"],
      outdir: join(dir, "dist"),
    });
    expect(logs).toBe("");
    expect(text).toContain("svelte/internal");
    expect(text).toContain("color: #639");
    expect(success).toBe(true);
  });

  test("svelte: false leaves .svelte files to Bun", async () => {
    const dir = await write({
      "A.svelte": "<p>{1 + 1}</p>\n",
      "main.ts": 'import A from "./A.svelte";\nconsole.log(A);\n',
    });
    // tailwind: false: an onLoad that returns undefined for a file Bun loads as an asset panics Bun 1.4.3-aphrody.2,
    // and @aphrody/bun-plugin-tailwind reads .svelte files that way.
    const { success, text } = await build(
      dir,
      "main.ts",
      m3Bun({ configDir: svelteDeps, svelte: false, tailwind: false }),
    );
    expect(text).not.toContain("svelte/internal");
    expect(text).toContain(".svelte");
    expect(success).toBe(true);
  });
});

test("svelte without its package is an error that names the option", async () => {
  const dir = await write({
    "A.svelte": "<p>hi</p>\n",
    "main.ts": 'import A from "./A.svelte";\nconsole.log(A);\n',
    // An app whose own @aphrody/bun-plugin-svelte cannot import `svelte/compiler`.
    "node_modules/@aphrody/bun-plugin-svelte/package.json":
      '{ "name": "@aphrody/bun-plugin-svelte", "type": "module", "exports": { ".": "./src/index.ts" } }\n',
    "node_modules/@aphrody/bun-plugin-svelte/src/index.ts":
      'export { compile } from "svelte/compiler";\nexport function SveltePlugin() { return { name: "x", setup() {} }; }\n',
  });
  const { success, logs } = await build(dir, "main.ts", m3Bun({ configDir: dir }));
  expect(success).toBe(false);
  expect(logs).toContain("m3-bun: svelte: importing @aphrody/bun-plugin-svelte failed");
});

const mdxDeps = depsFor("@aphrody/bun-mdx-rs");
describe.skipIf(!mdxDeps)("mdx: @aphrody/bun-mdx-rs", () => {
  test("mdx: true compiles .mdx to JSX through the native onBeforeParse hook", async () => {
    const dir = await write({
      "doc.mdx": "# Hello m3\n\nSome *emphasis*.\n",
      "main.tsx": 'import Doc from "./doc.mdx";\nconsole.log(Doc);\n',
    });
    const { success, logs, text } = await build(dir, "main.tsx", m3Bun({ configDir: mdxDeps, mdx: true }), {
      external: ["react", "react/*"],
    });
    expect(logs).toBe("");
    expect(text).toContain("Hello m3");
    expect(text).toContain("MDXContent");
    expect(success).toBe(true);
  });
});

const n2bDeps = depsFor("@aphrody/bun-plugin-n2b/plugin");
describe.skipIf(!n2bDeps)("n2b: @aphrody/bun-plugin-n2b", () => {
  test("n2b aggressive mode rewrites Node APIs to Bun's at load time without touching the file", async () => {
    const source = 'import fs from "fs";\nexport const text = fs.readFileSync("a.txt", "utf8");\n';
    const dir = await write({ "main.ts": source });
    const { success, logs, text } = await build(
      dir,
      "main.ts",
      m3Bun({ configDir: n2bDeps, n2b: { mode: "aggressive", quiet: true } }),
      { target: "bun" },
    );
    expect(logs).toBe("");
    expect(text).toContain('await Bun.file("a.txt").text()');
    expect(success).toBe(true);
    expect(await Bun.file(join(dir, "main.ts")).text()).toBe(source);
  });
});

const oxcDeps = depsFor("@aphrody/bun-plugin-oxc");
describe.skipIf(!oxcDeps)("oxc: @aphrody/bun-plugin-oxc", () => {
  test("oxc lint: error fails the build on an oxlint error", async () => {
    const dir = await write({ "main.ts": "const a: number = 1;\ndebugger;\nconsole.log(a);\n" });
    const linted = await build(dir, "main.ts", m3Bun({ configDir: oxcDeps, oxc: { lint: "error" } }));
    expect(linted.success).toBe(false);
    expect(linted.logs).toContain("oxc lint: 1 problem(s)");
    expect(linted.logs).toContain("`debugger` statement is not allowed");
  });

  test("oxc native: true transforms TypeScript on Bun's bundler threads", async () => {
    const dir = await write({ "main.ts": "const a: number = 41;\nexport const b = a + 1;\n" });
    const { success, logs, text } = await build(dir, "main.ts", m3Bun({ configDir: oxcDeps, oxc: { native: true } }));
    expect(logs).toBe("");
    expect(text).toContain("a + 1");
    expect(success).toBe(true);
  });
});

test("an enabled fork plugin whose package resolves nowhere fails with what to install", async () => {
  // The fixture has no node_modules: only @aphrody/m3-bun's own dependencies could answer.
  if (resolveFrom("@aphrody/bun-plugin-yaml", [import.meta.dir])) return;
  const dir = await write({ "a.yaml": "a: 1\n", "y.ts": 'import a from "./a.yaml"; console.log(a);\n' });
  const { success, logs } = await build(dir, "y.ts", m3Bun({ configDir: dir, yaml: true }));
  expect(success).toBe(false);
  expect(logs).toContain("m3-bun: yaml needs @aphrody/bun-plugin-yaml");
  expect(logs).toContain("bun add @aphrody/bun-plugin-yaml");
});
