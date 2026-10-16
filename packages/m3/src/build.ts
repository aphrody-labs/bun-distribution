// SPDX-License-Identifier: Apache-2.0
// `buildM3`: the one production build of an @aphrody/m3 application, a single `Bun.build` with
// `m3Plugin`. The Tauri mode writes the fixed layout the desktop webview loads
// (`crates/ui/app/ui-dist`, `tauri.conf.json` `frontendDist`):
//
//   index.html   app.js   app.css   fonts/<name>.<ext>
//
// Names carry no hash: the Tauri asset protocol serves the directory as is, and the CSP allows
// only `'self'` scripts, so every script stays an external module file.
import { build, type BuildArtifact, type BunPlugin } from "bun";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { m3Plugin, type M3PluginOptions } from "./plugin.js";

export interface BuildM3Tauri {
  /** Output directory of the webview (`frontendDist`). */
  uiDist: string;
}

export interface BuildM3Options {
  /** HTML entry (or entries; the Tauri mode takes exactly one). */
  entry: string | string[];
  /** Output directory (default `dist`; ignored in Tauri mode). */
  outdir?: string;
  /** Minify and set `NODE_ENV=production` (default true). */
  production?: boolean;
  /** Extra `define` constants. */
  define?: Record<string, string>;
  /** Function calls or statements to drop from bundle (e.g. `["debugger"]`, `["console"]`). */
  drop?: string[];
  /** Custom minification control. */
  minify?:
    boolean | { whitespace?: boolean; syntax?: boolean; identifiers?: boolean };
  /** Barrel files / packages to optimize unused named imports for. */
  optimizeImports?: string[];
  /** Tauri webview layout into `uiDist`. */
  tauri?: BuildM3Tauri;
  /** Options of the composed `m3Plugin`, or `false` to leave it out (a plugin in `plugins` replaces it, e.g. `@aphrody/m3-bun`). */
  plugin?: M3PluginOptions | false;
  /** Additional Bun plugins, after `m3Plugin`. */
  plugins?: BunPlugin[];
  /** Code splitting: shared and dynamically imported modules become hashed chunks (default false; the Tauri layout needs one script). */
  splitting?: boolean;
  /** Remove the output directory first (default true). */
  clean?: boolean;
  /** Base directory for relative paths (default: working directory). */
  cwd?: string;
}

export interface BuildM3Output {
  /** Path relative to the output directory, `/`-separated. */
  path: string;
  kind: BuildArtifact["kind"];
  bytes: number;
}

export interface BuildM3Result {
  outdir: string;
  outputs: BuildM3Output[];
}

/** Fixed names of the Tauri layout. */
export const TAURI_LAYOUT = {
  html: "index.html",
  script: "app.js",
  style: "app.css",
  fonts: "fonts",
} as const;

function toPosix(path: string): string {
  return path.replaceAll("\\", "/");
}

/** Replace every `src`/`href` attribute value equal to `from` with `to`. */
export function rewriteHtmlReference(
  html: string,
  from: string,
  to: string,
): string {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.replace(
    new RegExp(`((?:src|href)=["'])(?:\\./)?${escaped}(["'])`, "g"),
    `$1./${to}$2`,
  );
}

function describeBuildError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const detail = error as Error & {
    referrer?: string;
    specifier?: string;
    importKind?: string;
    position?: { file?: string; line?: number; column?: number };
  };
  const location = detail.position;
  const source = [
    detail.specifier && `import ${JSON.stringify(detail.specifier)}`,
    detail.referrer && `from ${detail.referrer}`,
    location?.file &&
      `at ${location.file}:${location.line ?? 0}:${location.column ?? 0}`,
    detail.importKind && `(${detail.importKind})`,
  ]
    .filter(Boolean)
    .join(" ");
  return `${error.stack ?? error.message}${source ? `\n  ${source}` : ""}`;
}

/** Build the application. */
export async function buildM3(options: BuildM3Options): Promise<BuildM3Result> {
  const cwd = options.cwd ?? process.cwd();
  const entries = (
    Array.isArray(options.entry) ? options.entry : [options.entry]
  ).map((entry) => resolve(cwd, entry));
  const production = options.production ?? true;
  const tauri = options.tauri;
  if (tauri && entries.length !== 1)
    throw new Error("buildM3: the Tauri layout takes exactly one HTML entry");
  if (tauri && !entries[0]!.endsWith(".html"))
    throw new Error("buildM3: the Tauri entry must be an .html file");
  const outdir = resolve(
    cwd,
    tauri ? tauri.uiDist : (options.outdir ?? "dist"),
  );
  const clean = options.clean ?? true;
  const buildOutdir = clean ? `${outdir}.stage-${crypto.randomUUID()}` : outdir;
  if (clean) await mkdir(dirname(outdir), { recursive: true });
  await mkdir(buildOutdir, { recursive: true });
  const drop = options.drop ?? (production ? ["debugger"] : undefined);
  const minifyConfig =
    options.minify !== undefined
      ? options.minify
      : production
        ? { whitespace: true, syntax: true, identifiers: true }
        : false;

  const result = await build({
    entrypoints: entries,
    root: cwd,
    outdir: buildOutdir,
    target: "browser",
    minify: minifyConfig,
    sourcemap: production ? "none" : "linked",
    splitting: tauri ? false : (options.splitting ?? false),
    define: {
      "process.env.NODE_ENV": JSON.stringify(
        production ? "production" : "development",
      ),
      ...options.define,
    },
    ...(drop && drop.length > 0 ? { drop } : {}),
    ...(options.optimizeImports && options.optimizeImports.length > 0
      ? { optimizeImports: options.optimizeImports }
      : {}),
    plugins: [
      ...(options.plugin === false ? [] : [m3Plugin(options.plugin)]),
      ...(options.plugins ?? []),
    ],
    ...(tauri
      ? {
          naming: {
            entry: "[name].[ext]",
            chunk: "app.[ext]",
            asset: `${TAURI_LAYOUT.fonts}/[name].[ext]`,
          },
        }
      : {}),
  }).catch(async (error: unknown) => {
    if (clean) await rm(buildOutdir, { recursive: true, force: true });
    const causes = error instanceof AggregateError ? error.errors : [error];
    const details = causes.map(describeBuildError).join("\n");
    throw new Error(
      `buildM3: Bun.build rejected${details ? `:\n${details}` : ""}`,
      {
        cause: error,
      },
    );
  });
  if (!result.success) {
    if (clean) await rm(buildOutdir, { recursive: true, force: true });
    const details = result.logs.map(describeBuildError).join("\n");
    throw new AggregateError(
      result.logs,
      `buildM3: ${result.logs.length} error(s) building ${entries.join(", ")}${details ? `:\n${details}` : ""}`,
    );
  }

  let outputs: BuildM3Output[] = result.outputs.map((artifact) => ({
    path: toPosix(relative(buildOutdir, artifact.path)),
    kind: artifact.kind,
    bytes: artifact.size,
  }));
  try {
    if (tauri)
      outputs = await normalizeTauriLayout(buildOutdir, entries[0]!, outputs);
    if (clean) {
      const backup = `${outdir}.backup-${crypto.randomUUID()}`;
      let hadOutput = false;
      try {
        await stat(outdir);
        hadOutput = true;
        await rename(outdir, backup);
      } catch (error) {
        if (hadOutput) throw error;
      }
      try {
        await rename(buildOutdir, outdir);
        if (hadOutput) await rm(backup, { recursive: true, force: true });
      } catch (error) {
        if (hadOutput) await rename(backup, outdir).catch(() => undefined);
        throw error;
      }
    }
  } catch (error) {
    if (clean) await rm(buildOutdir, { recursive: true, force: true });
    throw error;
  }
  return { outdir, outputs };
}

/**
 * Bring a Tauri build to the fixed layout: the HTML entry becomes `index.html` and its script
 * `app.js` (Bun names them after their sources), references rewritten.
 */
async function normalizeTauriLayout(
  outdir: string,
  entry: string,
  outputs: BuildM3Output[],
): Promise<BuildM3Output[]> {
  const htmlName = basename(entry);
  const htmlPath = join(outdir, htmlName);
  let html = await Bun.file(htmlPath).text();

  const scripts = outputs.filter(
    (o) => o.kind === "entry-point" && o.path.endsWith(".js"),
  );
  if (scripts.length > 1)
    throw new Error(
      `buildM3: the Tauri entry produced ${scripts.length} scripts; keep one module script`,
    );
  const script = scripts[0];
  if (script && script.path !== TAURI_LAYOUT.script) {
    await rename(join(outdir, script.path), join(outdir, TAURI_LAYOUT.script));
    html = rewriteHtmlReference(html, script.path, TAURI_LAYOUT.script);
    script.path = TAURI_LAYOUT.script;
  }

  await Bun.write(join(outdir, TAURI_LAYOUT.html), html);
  if (htmlName !== TAURI_LAYOUT.html) await rm(htmlPath, { force: true });

  return Promise.all(
    outputs.map(async (output) => {
      const path = output.path === htmlName ? TAURI_LAYOUT.html : output.path;
      return { ...output, path, bytes: (await stat(join(outdir, path))).size };
    }),
  );
}
