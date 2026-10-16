// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { join, relative } from "node:path";
import { tailwindM3Plugin } from "../src/tailwind.ts";
import { FIXTURE, tempDir } from "./helpers.ts";

async function buildCss(
  source: string | null,
  usePlugin: boolean,
): Promise<string> {
  await using tmp = await tempDir();
  const entry = join(tmp.dir, "entry.ts");
  const cssPath =
    source === null ? join(FIXTURE, "app.css") : join(tmp.dir, "app.css");
  if (source !== null) await Bun.write(cssPath, source);
  const specifier = relative(tmp.dir, cssPath).replaceAll("\\", "/");
  await Bun.write(
    entry,
    `import ${JSON.stringify(specifier.startsWith(".") ? specifier : `./${specifier}`)};`,
  );
  const result = await Bun.build({
    entrypoints: [entry],
    outdir: join(tmp.dir, "out"),
    plugins: usePlugin ? [tailwindM3Plugin()] : [],
  });
  if (!result.success)
    throw new AggregateError(result.logs, "CSS build failed");
  const css = result.outputs.find((output) => output.path.endsWith(".css"));
  if (!css) throw new Error("CSS build produced no CSS output");
  return (await css.text()).replace(/^\/\* .*app\.css \*\/\r?\n/, "");
}

test("M3 Tailwind generates explicit utilities with the separately resolved engine", async () => {
  const css = await buildCss(null, true);
  expect(css).toContain(".p-4");
  expect(css).toContain(".bg-primary");
  expect(css).not.toContain(".text-red-500");
});

test("plain CSS uses Bun's loader without Tailwind processing", async () => {
  const source = ".plain { color: rebeccapurple; }";
  expect(await buildCss(source, true)).toBe(await buildCss(source, false));
});
