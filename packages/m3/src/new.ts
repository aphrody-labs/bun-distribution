// SPDX-License-Identifier: Apache-2.0
// A minimal Bun/M3 project scaffold. No install or network access is performed.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

/** Create a new, previously absent M3 project directory. */
export async function createM3Project(directory: string): Promise<string> {
  const target = resolve(directory);
  const name = basename(target).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[._-]+|[._-]+$/g, "");
  if (!name) throw new Error(`m3 new: cannot derive a package name from ${directory}`);
  const { version } = JSON.parse(await readFile(join(import.meta.dir, "..", "package.json"), "utf8")) as { version: string };
  await mkdir(dirname(target), { recursive: true });
  await mkdir(target);
  await mkdir(join(target, "src"));

  const manifest = {
    name,
    private: true,
    type: "module",
    scripts: { dev: "m3 dev", build: "m3 build" },
    dependencies: { "@aphrody/m3": `^${version}` },
  };
  const files: Record<string, string> = {
    "package.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "bunfig.toml": '[serve.static]\nplugins = ["@aphrody/m3/plugin"]\n',
    "m3.config.ts": 'import { defineM3Config } from "@aphrody/m3/config";\n\nexport default defineM3Config({ entry: "index.html" });\n',
    "index.html": `<!doctype html>\n<html lang="en">\n  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${name}</title></head>\n  <body><div id="app"></div><script type="module" src="./src/main.ts"></script></body>\n</html>\n`,
    "src/main.ts": 'import "m3:theme.css";\nimport "m3:fonts.css";\n\nconst app = document.querySelector<HTMLDivElement>("#app");\nif (app) app.innerHTML = "<main><h1>Hello, M3</h1></main>";\n',
    ".gitignore": "node_modules/\ndist/\n",
  };
  await Promise.all(Object.entries(files).map(([path, content]) => writeFile(join(target, path), content)));
  return target;
}
