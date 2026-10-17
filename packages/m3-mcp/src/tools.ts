// SPDX-License-Identifier: Apache-2.0
// The M3 design tool table. It is hosted by the single Aphrody MCP server (`aphrody-mcp`) through
// `tool-host.ts` (`list` / `call`); this package no longer speaks MCP itself.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Target } from "@aphrody/m3-os-themes";
import { ROOT, listPackages, listTemplates, lookupTokens, researchLinks, searchDocs, validateTokens } from "./catalog";

// The theme generators (16 ms with m3-tokens) and the symbol catalogue are loaded by the tools that use them, not at
// start-up: listing the tools never waits for them.
const osThemes = () => import("@aphrody/m3-os-themes");
const symbols = () => import("@aphrody/material-design-icons");

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface M3Tool {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  run(args: never, signal?: AbortSignal): Promise<ToolResult> | ToolResult;
}

const text = (t: string): ToolResult => ({
  content: [{ type: "text", text: t || "(no result)" }],
});

const themeInput = {
  seed: z.string().describe("Seed colour #rrggbb"),
  target: z.enum(["windows", "gnome", "cosmic", "chromium", "all"]).default("all"),
  name: z.string().default("Aphrody"),
};

const limit = (fallback: number) => z.number().int().min(1).max(500).default(fallback);

function tool<S extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: S,
  run: (args: z.infer<z.ZodObject<S>>, signal?: AbortSignal) => Promise<ToolResult> | ToolResult,
): M3Tool {
  return { name, description, shape, run: run as M3Tool["run"] };
}

export const M3_TOOLS: M3Tool[] = [
  tool("m3_list_packages", "List the aphrody-m3 workspace packages with versions.", {}, () =>
    text(listPackages().join("\n")),
  ),
  tool(
    "m3_token_lookup",
    "Look up Material 3 design tokens (--md-*) by name or value fragment in m3-tokens.",
    { query: z.string(), limit: limit(50) },
    ({ query, limit: maximum }) =>
      text(
        lookupTokens(query, maximum)
          .map(t => `${t.name}: ${t.value}  [${t.source}]`)
          .join("\n"),
      ),
  ),
  tool(
    "m3_token_validate",
    "Validate that every --md-* custom property in a CSS snippet or name list exists in m3-tokens.",
    { css: z.string() },
    ({ css }) => {
      const r = validateTokens(css);
      return text(
        `checked ${r.checked.length}, unknown ${r.unknown.length}${r.unknown.length ? `\n${r.unknown.join("\n")}` : ""}`,
      );
    },
  ),
  tool(
    "m3_os_themes_list",
    "List the files m3-os-themes would generate for a seed colour and target (nothing is written).",
    themeInput,
    async ({ seed, target, name }) => {
      const { TARGETS, generate } = await osThemes();
      const targets: readonly Target[] = target === "all" ? TARGETS : [target];
      return text(
        generate({ name, seed, mode: "auto" }, targets)
          .map(f => f.path)
          .join("\n"),
      );
    },
  ),
  tool(
    "m3_os_themes_generate",
    "Return the text content of one generated OS theme file (path from m3_os_themes_list). Never writes to disk or the system.",
    { ...themeInput, path: z.string() },
    async ({ seed, target, name, path }) => {
      const { TARGETS, generate } = await osThemes();
      const targets: readonly Target[] = target === "all" ? TARGETS : [target];
      const file = generate({ name, seed, mode: "auto" }, targets).find(f => f.path === path);
      if (!file) return text(`unknown path ${path}`);
      return text(typeof file.content === "string" ? file.content : `(binary, ${file.content.length} bytes)`);
    },
  ),
  tool(
    "m3_docs_search",
    "Search the canonical native Web design-sync corpus (AI-ready Markdown, specs and asset JSON), followed by local M3 guides; returns source path:line hits.",
    { query: z.string(), limit: limit(20) },
    ({ query, limit: maximum }) => text(searchDocs(query, maximum).join("\n")),
  ),
  tool(
    "m3_research_links",
    "List the canonical native Web design-sync corpus files and source URLs; fall back to the dated local research index when no corpus has been acquired.",
    {},
    () => {
      const r = researchLinks();
      return text(`${r.files.join("\n")}\n\n${r.links.join("\n")}`);
    },
  ),
  tool("m3_list_templates", "List UI templates, examples and Tauri example apps.", {}, () =>
    text(listTemplates().join("\n")),
  ),
  tool(
    "m3_symbol_svg",
    "Return path and SVG source of a Material Symbol from the forked catalogue.",
    {
      name: z.string().regex(/^[a-z0-9_]+$/),
      style: z.enum(["outlined", "rounded", "sharp"]).default("outlined"),
      weight: z
        .union([
          z.literal(100),
          z.literal(200),
          z.literal(300),
          z.literal(400),
          z.literal(500),
          z.literal(600),
          z.literal(700),
        ])
        .default(400),
      filled: z.boolean().default(false),
    },
    async ({ name, style, weight, filled }) => {
      const { symbolSvgPath } = await symbols();
      const p = symbolSvgPath(name, style, weight, filled);
      return existsSync(p) ? text(`${p}\n${readFileSync(p, "utf8")}`) : text(`not found: ${p}`);
    },
  ),
  tool(
    "m3_symbol_search",
    "Search the full Material Symbols catalogue (4150 names) by substring; returns matching symbol names.",
    { query: z.string(), limit: limit(50) },
    async ({ query, limit: maximum }) => {
      const { searchSymbols, symbolNames } = await symbols();
      const hits = searchSymbols(query, maximum);
      return text(hits.length > 0 ? hits.join("\n") : `no match among ${symbolNames().length} symbols`);
    },
  ),
  tool(
    "m3_svg_to_ico",
    "Generate Tauri desktop icons (ico, icns, png) from a symbol name or SVG file.",
    {
      input: z.string(),
      out: z.string().default("src-tauri/icons"),
      style: z.enum(["outlined", "rounded", "sharp"]).default("outlined"),
      fill: z.string().optional(),
    },
    async ({ input, out, style, fill }, signal) => {
      const args = [
        "bun",
        join(ROOT, "packages/material-design-icons/scripts/svg-to-ico.ts"),
        input,
        "--out",
        out,
        "--style",
        style,
      ];
      if (fill) args.push("--fill", fill);
      const child = Bun.spawn({
        windowsHide: true,
        cmd: args,
        stdout: "pipe",
        stderr: "pipe",
        signal,
        timeout: 30_000,
        killSignal: "SIGKILL",
        maxBuffer: 1024 * 1024,
      });
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return {
        ...text(`${code}\n${stdout}${stderr}`),
        ...(code !== 0 ? { isError: true } : {}),
      };
    },
  ),
];

/** JSON Schema definitions in the shape every MCP client expects from `tools/list`. */
export function listM3Tools(): {
  name: string;
  description: string;
  inputSchema: unknown;
}[] {
  return M3_TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: z.toJSONSchema(z.object(t.shape)),
  }));
}

/** Validate the arguments with the tool's schema, then run it; failures are `isError` results. */
export async function callM3Tool(name: string, args: unknown, signal?: AbortSignal): Promise<ToolResult> {
  const found = M3_TOOLS.find(t => t.name === name);
  if (!found) return { ...text(`unknown tool ${name}`), isError: true };
  const parsed = z.object(found.shape).safeParse(args ?? {});
  if (!parsed.success) return { ...text(parsed.error.message), isError: true };
  try {
    return await found.run(parsed.data as never, signal);
  } catch (error) {
    return {
      ...text(error instanceof Error ? error.message : String(error)),
      isError: true,
    };
  }
}
