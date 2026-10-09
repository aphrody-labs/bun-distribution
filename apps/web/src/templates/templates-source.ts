// SPDX-License-Identifier: Apache-2.0
// Server-side: reads the project templates of `yolo create` (m3/templates) so the Templates
// window shows the real files instead of a copy.
import { basename, extname, join } from "node:path";
import { REPO_ROOT } from "../core/codebase-scanner";
import type { TemplateDefinition, TemplateFile } from "./templates-data";

interface StackTemplate {
  path: string;
  description?: string;
  required?: boolean;
  exclusive?: string;
  dependencies?: Record<string, string>;
  dev_dependencies?: Record<string, string>;
  curated?: string;
}

const LANGUAGES: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".json": "json",
  ".toml": "toml",
  ".md": "markdown",
  ".css": "css",
  ".html": "html",
  ".rs": "rust",
  ".xml": "xml",
};
const EXTRA_TEXT_FILES = new Set(["Dockerfile", "gitignore"]);
const MAX_FILE_BYTES = 64 * 1024;

function createCommand(id: string, template: StackTemplate): string {
  if (template.required) return "just yolo::create ../my-app";
  if (template.exclusive === "framework") return `just yolo::create ../my-app --framework ${id}`;
  return `just yolo::create ../my-app --with ${id}`;
}

async function readTemplateFiles(dir: string): Promise<TemplateFile[]> {
  const files: TemplateFile[] = [];
  for await (const rel of new Bun.Glob("**/*").scan({ cwd: dir, onlyFiles: true, dot: true })) {
    const path = rel.replaceAll("\\", "/");
    const name = basename(path);
    const ext = extname(name);
    if (!(ext in LANGUAGES) && !EXTRA_TEXT_FILES.has(name)) continue;
    const file = Bun.file(join(dir, rel));
    if (file.size > MAX_FILE_BYTES) continue;
    files.push({ name, path, language: LANGUAGES[ext] ?? "text", content: await file.text() });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** Templates declared in `[template.*]` of m3/templates/stack.toml, with their text files. */
export async function loadTemplates(root: string = REPO_ROOT): Promise<TemplateDefinition[]> {
  const stack = Bun.TOML.parse(await Bun.file(join(root, "m3/templates/stack.toml")).text()) as {
    template?: Record<string, StackTemplate>;
  };
  const templates: TemplateDefinition[] = [];
  for (const [id, template] of Object.entries(stack.template ?? {})) {
    const tags = [
      template.required ? "required" : undefined,
      template.exclusive ? `exclusive: ${template.exclusive}` : undefined,
      template.curated,
    ].filter((tag): tag is string => Boolean(tag));
    templates.push({
      id,
      name: id,
      tagline: template.description ?? "",
      description: `${template.path} in m3/templates/stack.toml`,
      tags,
      cliCommand: createCommand(id, template),
      dependencies: { ...template.dependencies, ...template.dev_dependencies },
      files: await readTemplateFiles(join(root, template.path)),
    });
  }
  return templates;
}
