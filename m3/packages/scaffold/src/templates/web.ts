// SPDX-License-Identifier: Apache-2.0
/**
 * Bun-owned adapter for the web scaffold. The implementation stays in the
 * canonical Bun submodule; Aphrody exposes the stable scaffold API without a
 * second template copy.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { FileMap } from "../files.ts";

export interface WebTemplateOptions {
  name: string;
  m3Version?: string;
}

const configuredRoot = Bun.env.APHRODY_BUN_CHECKOUT ?? Bun.env.BUN_ROOT;
const bunRoot = configuredRoot && existsSync(join(configuredRoot, "packages/aphrody-migrated/m3/aphrody-m3"))
  ? configuredRoot
  : resolve(import.meta.dir, "../../../../../../bun");
const canonicalRoot = join(bunRoot, "packages/aphrody-migrated/m3/aphrody-m3");
const canonicalTemplate = join(canonicalRoot, "packages/scaffold/src/templates/web.ts");
const implementation = existsSync(canonicalTemplate) && existsSync(join(canonicalRoot, "packages/m3/package.json"))
  ? ((await import(Bun.pathToFileURL(canonicalTemplate).href)) as {
      webFiles(options: { name: string; m3Version: string }): FileMap;
    })
  : undefined;

export function ownerM3Version(): string {
  const manifestPath = existsSync(join(canonicalRoot, "packages/m3/package.json"))
    ? join(canonicalRoot, "packages/m3/package.json")
    : resolve(import.meta.dir, "../../../m3/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    version: string;
  };
  return manifest.version;
}

export function webFiles(options: WebTemplateOptions): FileMap {
  const m3Version = options.m3Version ?? ownerM3Version();
  if (implementation) return implementation.webFiles({ name: options.name, m3Version });
  const manifest = {
    name: options.name,
    private: true,
    type: "module",
    scripts: { dev: "m3 dev", build: "m3 build" },
    dependencies: { "@aphrody/m3": "workspace:*" },
  };
  return {
    "package.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "bunfig.toml": '[serve.static]\nplugins = ["@aphrody/m3/plugin"]\n',
    "m3.config.ts": 'import { defineM3Config } from "@aphrody/m3/config";\n\nexport default defineM3Config({ entry: "index.html" });\n',
    "index.html": `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${options.name}</title></head><body><div id="app"></div><script type="module" src="./src/main.ts"></script></body></html>\n`,
    "src/main.ts": 'import "m3:theme.css";\nimport "m3:fonts.css";\n\nconst app = document.querySelector<HTMLDivElement>("#app");\nif (app) app.innerHTML = "<main><h1>Hello, M3</h1></main>";\n',
    ".gitignore": "node_modules/\ndist/\n",
  };
}
