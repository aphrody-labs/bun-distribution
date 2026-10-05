// SPDX-License-Identifier: Apache-2.0
// The codemod set: Next 14/15 -> 16, MUI -> M3 (Base UI), Tailwind v3 -> v4. Each codemod is a pure function from
// source text to source text (plus changes and warnings); `runCodemods` applies them to a project.
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { awaitRequestApis, awaitRouteProps, isRouteFile, revalidateTagProfile } from "./async-apis";
import { isMiddlewareFile, middlewareToProxy } from "./middleware";
import { muiToM3 } from "./mui";
import { nextConfigTo16 } from "./next-config";
import { legacyImage, packageJsonTo16 } from "./next-misc";
import {
  postcssConfigV4,
  tailwindClassesV4,
  tailwindConfigToCss,
  tailwindCssV4,
  tailwindPackageJsonV4,
} from "./tailwind";
import type { Codemod, CodemodResult } from "./types";

export { nextConfigTo16, EXPERIMENTAL_MOVES } from "./next-config";
export { middlewareToProxy, isMiddlewareFile } from "./middleware";
export {
  awaitRequestApis,
  awaitRouteProps,
  revalidateTagProfile,
  functionSpans,
  isRouteFile,
} from "./async-apis";
export { legacyImage, packageJsonTo16, TARGET_VERSIONS } from "./next-misc";
export { muiToM3 } from "./mui";
export {
  classListV3ToV4,
  postcssConfigV4,
  RENAMED,
  tailwindClassesV4,
  tailwindConfigToCss,
  tailwindCssV4,
  tailwindPackageJsonV4,
} from "./tailwind";
export { appTarget, featureNotes, pagesHints, type PagesHint } from "./pages";
export type { Codemod, CodemodResult } from "./types";

const isCode = (path: string): boolean => /\.(tsx?|jsx?|mjs|cjs|mts|cts)$/.test(path);
const isMarkup = (path: string): boolean => isCode(path) || /\.(html|mdx?|vue|svelte)$/.test(path);
const base = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

export const CODEMODS: readonly Codemod[] = [
  {
    id: "next-config",
    group: "next16",
    title:
      "next.config: experimental flags to the top level (cacheComponents, turbopack, ...), drop eslint, images.domains -> remotePatterns",
    test: (p) => /^next\.config\.(js|mjs|cjs|ts|mts)$/.test(base(p)),
    run: (source) => nextConfigTo16(source),
  },
  {
    id: "middleware-to-proxy",
    group: "next16",
    title: "middleware.ts -> proxy.ts, export middleware -> proxy, drop the edge runtime flag",
    test: isMiddlewareFile,
    run: middlewareToProxy,
  },
  {
    id: "async-request-apis",
    group: "next16",
    title: "await cookies(), headers() and draftMode(); make the enclosing function async",
    test: (p) => isCode(p) && !/(^|\/)next\.config\./.test(p),
    run: (source) => awaitRequestApis(source),
  },
  {
    id: "async-route-props",
    group: "next16",
    title: "params and searchParams are Promises in page, layout, route and metadata files",
    test: isRouteFile,
    run: awaitRouteProps,
  },
  {
    id: "revalidate-tag",
    group: "next16",
    title: 'revalidateTag(tag) -> revalidateTag(tag, "max")',
    test: isCode,
    run: (source) => revalidateTagProfile(source),
  },
  {
    id: "legacy-image",
    group: "next16",
    title: "next/legacy/image -> next/image",
    test: isCode,
    run: (source) => legacyImage(source),
  },
  {
    id: "next-package-json",
    group: "next16",
    title: "package.json: next, react, types versions; next lint and --turbo scripts",
    test: (p) => p === "package.json",
    run: (source) => packageJsonTo16(source),
  },
  {
    id: "mui-to-m3",
    group: "mui",
    title:
      "MUI Button, Switch, Checkbox, Divider -> Base UI wrappers; Typography, Stack, Box, Paper -> elements with M3 classes",
    test: (p) => /\.(tsx|jsx)$/.test(p),
    run: (source) => muiToM3(source),
  },
  {
    id: "tailwind-css-v4",
    group: "tailwind4",
    title: '@tailwind directives -> @import "tailwindcss"; @layer utilities -> @utility; theme()',
    test: (p) => /\.(css|pcss)$/.test(p),
    run: (source) => tailwindCssV4(source),
  },
  {
    id: "tailwind-classes-v4",
    group: "tailwind4",
    title:
      "renamed utilities (shadow-sm, rounded, ring, ...), bg-opacity-* -> /50, !important -> trailing !, bg-[--x] -> bg-(--x)",
    test: isMarkup,
    run: (source) => tailwindClassesV4(source),
  },
  {
    id: "tailwind-config-v4",
    group: "tailwind4",
    title: "tailwind.config.js -> tailwind-theme.css (@theme, @plugin, @custom-variant)",
    test: (p) => /^tailwind\.config\.[cm]?[jt]s$/.test(base(p)),
    run: tailwindConfigToCss,
  },
  {
    id: "postcss-config-v4",
    group: "tailwind4",
    title:
      "postcss.config: tailwindcss -> @tailwindcss/postcss, drop autoprefixer and postcss-import",
    test: (p) => /^postcss\.config\.[cm]?[jt]s$|^\.postcssrc(\.json|\.[cm]?js)?$/.test(base(p)),
    run: (source) => postcssConfigV4(source),
  },
  {
    id: "tailwind-package-json",
    group: "tailwind4",
    title:
      "package.json: tailwindcss ^4, @tailwindcss/postcss; drop autoprefixer and postcss-import",
    test: (p) => p === "package.json",
    run: (source) => tailwindPackageJsonV4(source),
  },
];

export const CODEMOD_GROUPS = ["next16", "mui", "tailwind4"] as const;

/** Resolve ids (`all`, a group name, or codemod ids) to codemods; unknown ids throw. */
export function selectCodemods(ids: readonly string[]): Codemod[] {
  if (ids.length === 0 || ids.includes("all")) return [...CODEMODS];
  const out = new Set<Codemod>();
  for (const id of ids) {
    const group = CODEMODS.filter((c) => c.group === id);
    if (group.length > 0) for (const c of group) out.add(c);
    else {
      const one = CODEMODS.find((c) => c.id === id);
      if (!one) throw new Error(`unknown codemod "${id}" (try --list)`);
      out.add(one);
    }
  }
  return [...out];
}

export interface FileReport {
  file: string;
  codemod: string;
  changes: string[];
  warnings: string[];
  rename?: string;
}

export interface RunOptions {
  /** Project root. */
  dir: string;
  /** Codemod ids or groups; empty means all. */
  ids?: readonly string[];
  /** Write the changes (default: report only). */
  apply?: boolean;
}

/** `true` when package.json asks for tailwindcss 4 or later. */
async function onTailwind4(dir: string): Promise<boolean> {
  try {
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const version = pkg.devDependencies?.["tailwindcss"] ?? pkg.dependencies?.["tailwindcss"] ?? "";
    return /^[\^~>=\s]*([4-9]|[1-9]\d)\./.test(version);
  } catch {
    return false;
  }
}

/* oxlint-disable eslint/no-await-in-loop -- files are processed in order: a rename must precede the next codemod on the same file */
const SKIP = new Set(["node_modules", ".next", "dist", "out", ".git", ".turbo", "coverage"]);

async function walk(root: string, dir: string, out: string[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(root, full, out);
    else out.push(full.slice(root.length + 1).replace(/\\/g, "/"));
  }
}

/** Run codemods over a project. Without `apply` nothing is written. */
export async function runCodemods(options: RunOptions): Promise<FileReport[]> {
  let codemods = selectCodemods(options.ids ?? []);
  const files: string[] = [];
  await walk(options.dir, options.dir, files);
  files.sort();
  const reports: FileReport[] = [];
  // The utility renames cannot tell v3 class lists from v4 ones (v3 `shadow` and v4 `shadow-sm` are the same utility),
  // so they run once: a project already on Tailwind 4 is skipped.
  if (codemods.some((c) => c.id === "tailwind-classes-v4") && (await onTailwind4(options.dir))) {
    codemods = codemods.filter((c) => c.id !== "tailwind-classes-v4");
    reports.push({
      file: "package.json",
      codemod: "tailwind-classes-v4",
      changes: [],
      warnings: ["skipped: the project is already on Tailwind 4 (the renames would apply twice)"],
    });
  }
  for (const file of files) {
    const applicable = codemods.filter((c) => c.test(file));
    if (applicable.length === 0) continue;
    let source = await readFile(join(options.dir, file), "utf8");
    let current = file;
    for (const codemod of applicable) {
      const result: CodemodResult = codemod.run(source, current);
      const changed = result.code !== source || result.rename !== undefined;
      if (changed || result.warnings.length > 0)
        reports.push({
          file: current,
          codemod: codemod.id,
          changes: result.changes,
          warnings: result.warnings,
          ...(result.rename ? { rename: result.rename } : {}),
        });
      source = result.code;
      if (result.rename && result.rename !== current) {
        if (options.apply) {
          await mkdir(dirname(join(options.dir, result.rename)), { recursive: true });
          await writeFile(join(options.dir, result.rename), source);
          await rm(join(options.dir, current));
        }
        current = result.rename;
      } else if (changed && options.apply) await writeFile(join(options.dir, current), source);
    }
  }
  return reports;
}
