#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Target } from "@aphrody/m3-os-themes";
import {
  ROOT,
  listPackages,
  listTemplates,
  lookupTokens,
  researchLinks,
  searchDocs,
  validateTokens,
} from "./catalog";

// The theme generators (16 ms with m3-tokens) and the symbol catalogue are loaded by the tools that use them, not at
// start-up: the handshake with the client no longer waits for them.
const osThemes = () => import("@aphrody/m3-os-themes");
const symbols = () => import("@aphrody/material-design-icons");

const text = (t: string) => ({ content: [{ type: "text" as const, text: t || "(no result)" }] });

/** Construct the design server without connecting or taking ownership of stdin. */
export function createM3McpServer(): McpServer {
  const server = new McpServer({ name: "aphrody-m3", version: "1.1.0" });

  server.tool(
    "m3_list_packages",
    "List the aphrody-m3 workspace packages with versions.",
    {},
    async () => text(listPackages().join("\n")),
  );

  server.tool(
    "m3_token_lookup",
    "Look up Material 3 design tokens (--md-*) by name or value fragment in m3-tokens.",
    { query: z.string(), limit: z.number().int().min(1).max(500).default(50) },
    async ({ query, limit }) =>
      text(
        lookupTokens(query, limit)
          .map((t) => `${t.name}: ${t.value}  [${t.source}]`)
          .join("\n"),
      ),
  );

  server.tool(
    "m3_token_validate",
    "Validate that every --md-* custom property in a CSS snippet or name list exists in m3-tokens.",
    { css: z.string() },
    async ({ css }) => {
      const r = validateTokens(css);
      return text(
        `checked ${r.checked.length}, unknown ${r.unknown.length}${r.unknown.length ? `\n${r.unknown.join("\n")}` : ""}`,
      );
    },
  );

  const themeInput = {
    seed: z.string().describe("Seed colour #rrggbb"),
    target: z.enum(["windows", "gnome", "cosmic", "chromium", "all"]).default("all"),
    name: z.string().default("Aphrody"),
  };

  server.tool(
    "m3_os_themes_list",
    "List the files m3-os-themes would generate for a seed colour and target (nothing is written).",
    themeInput,
    async ({ seed, target, name }) => {
      const { TARGETS, generate } = await osThemes();
      const targets: readonly Target[] = target === "all" ? TARGETS : [target];
      return text(
        generate({ name, seed, mode: "auto" }, targets)
          .map((f) => f.path)
          .join("\n"),
      );
    },
  );

  server.tool(
    "m3_os_themes_generate",
    "Return the text content of one generated OS theme file (path from m3_os_themes_list). Never writes to disk or the system.",
    { ...themeInput, path: z.string() },
    async ({ seed, target, name, path }) => {
      const { TARGETS, generate } = await osThemes();
      const targets: readonly Target[] = target === "all" ? TARGETS : [target];
      const file = generate({ name, seed, mode: "auto" }, targets).find((f) => f.path === path);
      if (!file) return text(`unknown path ${path}`);
      return text(
        typeof file.content === "string" ? file.content : `(binary, ${file.content.length} bytes)`,
      );
    },
  );

  server.tool(
    "m3_docs_search",
    "Case-insensitive line search over aphrody-m3 docs/ (md, mdx); returns path:line hits.",
    { query: z.string(), limit: z.number().int().min(1).max(500).default(20) },
    async ({ query, limit }) => text(searchDocs(query, limit).join("\n")),
  );

  server.tool(
    "m3_research_links",
    "List docs/research files and the curated dated Google design/research link index.",
    {},
    async () => {
      const r = researchLinks();
      return text(`${r.files.join("\n")}\n\n${r.links.join("\n")}`);
    },
  );

  server.tool(
    "m3_list_templates",
    "List UI templates, examples and Tauri example apps.",
    {},
    async () => text(listTemplates().join("\n")),
  );

  server.tool(
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
  );

  server.tool(
    "m3_symbol_search",
    "Search the full Material Symbols catalogue (4150 names) by substring; returns matching symbol names.",
    { query: z.string(), limit: z.number().int().min(1).max(500).default(50) },
    async ({ query, limit }) => {
      const { searchSymbols, symbolNames } = await symbols();
      const hits = searchSymbols(query, limit);
      return text(
        hits.length > 0 ? hits.join("\n") : `no match among ${symbolNames().length} symbols`,
      );
    },
  );

  server.tool(
    "m3_svg_to_ico",
    "Generate Tauri desktop icons (ico, icns, png) from a symbol name or SVG file.",
    {
      input: z.string(),
      out: z.string().default("src-tauri/icons"),
      style: z.enum(["outlined", "rounded", "sharp"]).default("outlined"),
      fill: z.string().optional(),
    },
    async ({ input, out, style, fill }, { signal }) => {
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
      return { ...text(`${code}\n${stdout}${stderr}`), ...(code !== 0 ? { isError: true } : {}) };
    },
  );

  return server;
}

if (import.meta.main) {
  void createM3McpServer()
    .connect(new StdioServerTransport())
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
