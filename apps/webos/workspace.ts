// SPDX-License-Identifier: Apache-2.0
import { cp, lstat, mkdir } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

/** Assemble the existing App UI artifact; compilation remains owned by packages/app-ui. */
export async function stageWorkspace(
  dist: string,
  root: string,
  source = Bun.env.BUN_OS_APP_UI_DIST,
): Promise<void> {
  const directory = resolve(root, source ?? "build/app-ui");
  const index = Bun.file(join(directory, "index.html"));
  if (!(await index.exists()))
    throw new Error(
      `Missing App UI artifact ${directory}. Build packages/app-ui/build.ts --base /workspace/ --out ${directory} through the VPS factory first.`,
    );
  const html = await index.text();
  if (!/<base\s+href=["']\/workspace\/["']/.test(html))
    throw new Error(
      "App UI must be built with --base /workspace/ before desktop assembly.",
    );
  const scripts = [
    ...html.matchAll(/<script\b[^>]*\bsrc=["']\.\/([^"']+)["']/g),
  ].map((match) => match[1]!.split("?")[0]!);
  if (!scripts.length)
    throw new Error("App UI artifact has no executable entry script.");
  for (const path of [...scripts, "wasm/aphrody_webos_wasm_bg.wasm"]) {
    if (
      path.includes("\\") ||
      path.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw new Error("App UI artifact references an invalid asset path.");
    if (!(await Bun.file(join(directory, path)).exists()))
      throw new Error(`Missing App UI asset ${path}`);
  }
  await mkdir(join(dist, "workspace"), { recursive: true });
  await cp(directory, join(dist, "workspace"), { recursive: true });
}

interface StackTemplate {
  path: string;
  description?: string;
  required?: boolean;
  exclusive?: string;
  curated?: string;
  dependencies?: Record<string, string>;
  dev_dependencies?: Record<string, string>;
}

const TEMPLATE_LANGUAGES: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  json: "json",
  toml: "toml",
  md: "markdown",
  css: "css",
  html: "html",
  rs: "rust",
  xml: "xml",
};
const MAX_TEMPLATE_FILE_BYTES = 64 * 1024;

/** Text files of one template, as crates/aphrody-site/src/templates.rs lists them. */
async function templateFiles(directory: string) {
  const files: {
    name: string;
    path: string;
    language: string;
    content: string;
  }[] = [];
  for await (const path of new Bun.Glob("**/*").scan({
    cwd: directory,
    dot: true,
    followSymlinks: false,
  })) {
    const full = join(directory, path);
    const info = await lstat(full);
    if (info.isSymbolicLink())
      throw new Error(`Template symlink denied: ${full}`);
    if (!info.isFile() || info.size > MAX_TEMPLATE_FILE_BYTES) continue;
    const name = basename(path);
    const language =
      name === "Dockerfile" || name === "gitignore"
        ? "text"
        : TEMPLATE_LANGUAGES[extname(name).slice(1)];
    if (!language) continue;
    files.push({
      name,
      path: path.replaceAll("\\", "/"),
      language,
      content: await Bun.file(full).text(),
    });
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * The Workspace's Documentation and Templates catalogs, served by the Worker at /api/docs and
 * /api/templates: the same arrays the native product site (crates/aphrody-site) answers, read from
 * the same owners (crates/aphrody-site/data/docs.json, packages/m3-templates/stack.toml).
 */
export async function stageWorkspaceCatalogs(
  dist: string,
  root: string,
): Promise<void> {
  const docs = (await Bun.file(
    join(root, "crates/aphrody-site/data/docs.json"),
  ).json()) as unknown;
  if (!Array.isArray(docs))
    throw new Error("crates/aphrody-site/data/docs.json must be an array.");
  const owner = join(root, "packages/m3-templates");
  const stack = Bun.TOML.parse(
    await Bun.file(join(owner, "stack.toml")).text(),
  ) as { template?: Record<string, StackTemplate> };
  const templates = [];
  for (const id of Object.keys(stack.template ?? {}).sort()) {
    const template = stack.template![id]!;
    // The flattened package keeps manifest-relative `templates/<name>` declarations.
    const relative = template.path.startsWith("templates/")
      ? `packages/m3-templates/${template.path.slice("templates/".length)}`
      : template.path;
    if (
      !relative.startsWith("packages/m3-templates/") ||
      relative.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw new Error(`Template ${id} lies outside packages/m3-templates.`);
    const tags = [
      ...(template.required ? ["required"] : []),
      ...(template.exclusive ? [`exclusive: ${template.exclusive}`] : []),
      ...(template.curated ? [template.curated] : []),
    ];
    templates.push({
      id,
      name: id,
      tagline: template.description ?? "",
      description: `${template.path} in packages/m3-templates/stack.toml`,
      tags,
      cliCommand: template.required
        ? "just yolo::create ../my-app"
        : template.exclusive === "framework"
          ? `just yolo::create ../my-app --framework ${id}`
          : `just yolo::create ../my-app --with ${id}`,
      dependencies: {
        ...template.dependencies,
        ...template.dev_dependencies,
      },
      files: await templateFiles(join(root, relative)),
    });
  }
  await mkdir(join(dist, "api"), { recursive: true });
  await Bun.write(join(dist, "api/docs.json"), JSON.stringify(docs));
  await Bun.write(join(dist, "api/templates.json"), JSON.stringify(templates));
}
