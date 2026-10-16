// SPDX-License-Identifier: Apache-2.0
// `m3-bun create <template> <dir>`: a new project from `@aphrody/scaffold`, the single scaffolder of the UI stack
// (`web`, `app`, `spa`, `example`). It writes nothing over existing files and, like `aphrody-scaffold`, only into a
// declared member of the Aphrody/M3 workspace.
import type { TemplateName } from "@aphrody/scaffold";
import { basename, resolve } from "node:path";
import { loadTool } from "./tools-load.ts";

export interface CreateOptions {
  template: TemplateName;
  dir: string;
  /** npm name (default: from the directory name). */
  name?: string;
  /** `app` template: `vite` (native Bun web, default) or `tauri`. */
  target?: "tauri" | "vite";
  /** List the files instead of writing them. */
  dryRun?: boolean;
}

export interface CreateReport {
  template: TemplateName;
  dir: string;
  name: string;
  /** Relative paths when `dryRun`, absolute paths written otherwise. */
  files: string[];
  written: boolean;
}

/** The templates `m3-bun create` offers, with their summaries. */
export async function createTemplates(): Promise<
  ReadonlyArray<{ name: TemplateName; summary: string }>
> {
  return (
    await loadTool("@aphrody/scaffold", () => import("@aphrody/scaffold"))
  ).TEMPLATES;
}

type Scaffold = typeof import("@aphrody/scaffold");

function scaffoldRequest(
  options: CreateOptions,
  name: string,
  scaffold: Scaffold,
): Parameters<Scaffold["renderTemplate"]>[0] {
  switch (options.template) {
    case "example":
      return { template: "example", name };
    case "app":
      return {
        template: "app",
        name,
        target: options.target ?? "vite",
        modernizeM3: true,
      };
    case "spa":
      return { template: "spa", name };
    case "web":
      return { template: "web", name, m3Version: scaffold.ownerM3Version() };
    default:
      throw new Error(
        `m3-bun create: unknown template ${String(options.template)} (${scaffold.TEMPLATES.map((t) => t.name).join(", ")})`,
      );
  }
}

/** Render a template and, unless `dryRun`, write it with `scaffold()`. */
export async function createApp(options: CreateOptions): Promise<CreateReport> {
  const scaffold = await loadTool(
    "@aphrody/scaffold",
    () => import("@aphrody/scaffold"),
  );
  const dir = resolve(options.dir);
  const name =
    options.name ?? scaffold.npmName(basename(dir)) ?? scaffold.EXAMPLE_NAME;
  const request = scaffoldRequest(options, name, scaffold);
  if (options.dryRun) {
    return {
      template: options.template,
      dir,
      name,
      files: Object.keys(scaffold.renderTemplate(request)).toSorted(),
      written: false,
    };
  }
  return {
    template: options.template,
    dir,
    name,
    files: await scaffold.scaffold(dir, request),
    written: true,
  };
}
