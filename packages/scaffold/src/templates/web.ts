// SPDX-License-Identifier: Apache-2.0
/** A minimal Bun + M3 web project (`m3 new`). No install or network access is performed. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PRIVATE_OWNER_ROOT } from "../workspace";
import type { FileMap } from "../files.ts";

export interface WebTemplateOptions {
  /** npm package name and page title. */
  name: string;
  /** Version range of `@aphrody/m3` the project depends on, without the caret. */
  m3Version: string;
}

export function webFiles({ name, m3Version }: WebTemplateOptions): FileMap {
  const ownerVersion = (
    JSON.parse(
      readFileSync(
        resolve(PRIVATE_OWNER_ROOT, "packages/m3/package.json"),
        "utf8",
      ),
    ) as {
      version: string;
    }
  ).version;
  if (m3Version !== ownerVersion)
    throw new Error(
      `The private M3 owner version is ${ownerVersion}; source acquisition is required for requested version ${m3Version}`,
    );
  const manifest = {
    name,
    private: true,
    type: "module",
    scripts: { dev: "m3 dev", build: "m3 build" },
    dependencies: { "@aphrody/m3": "workspace:*" },
  };
  return {
    "package.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "bunfig.toml": '[serve.static]\nplugins = ["@aphrody/m3/plugin"]\n',
    "m3.config.ts":
      'import { defineM3Config } from "@aphrody/m3/config";\n\nexport default defineM3Config({ entry: "index.html" });\n',
    "index.html": `<!doctype html>\n<html lang="en">\n  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${name}</title></head>\n  <body><div id="app"></div><script type="module" src="./src/main.ts"></script></body>\n</html>\n`,
    "src/main.ts":
      'import "m3:theme.css";\nimport "m3:fonts.css";\n\nconst app = document.querySelector<HTMLDivElement>("#app");\nif (app) app.innerHTML = "<main><h1>Hello, M3</h1></main>";\n',
    ".gitignore": "node_modules/\ndist/\n",
  };
}
