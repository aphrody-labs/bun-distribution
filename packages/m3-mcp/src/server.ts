#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { symbolSvgPath } from "@aphrody/material-design-icons";
import {
  ROOT,
  listPackages,
  listTemplates,
  lookupTokens,
  researchLinks,
  searchDocs,
  validateTokens,
} from "./catalog";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t || "(no result)" }] });

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
  { query: z.string(), limit: z.number().int().positive().default(50) },
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

server.tool(
  "m3_docs_search",
  "Case-insensitive line search over aphrody-m3 docs/ (md, mdx); returns path:line hits.",
  { query: z.string(), limit: z.number().int().positive().default(20) },
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
    name: z.string(),
    style: z.enum(["outlined", "rounded", "sharp"]).default("outlined"),
    weight: z.number().default(400),
    filled: z.boolean().default(false),
  },
  async ({ name, style, weight, filled }) => {
    const p = symbolSvgPath(name, style, weight, filled);
    return existsSync(p) ? text(`${p}\n${readFileSync(p, "utf8")}`) : text(`not found: ${p}`);
  },
);

server.tool(
  "m3_svg_to_ico",
  "Generate Tauri desktop icons (ico, icns, png) from a symbol name or SVG file.",
  {
    input: z.string(),
    out: z.string().default("src-tauri/icons"),
    style: z.string().default("outlined"),
    fill: z.string().optional(),
  },
  async ({ input, out, style, fill }) => {
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
    const r = Bun.spawnSync(args);
    return text(`${r.exitCode}\n${r.stdout}${r.stderr}`);
  },
);

await server.connect(new StdioServerTransport());
