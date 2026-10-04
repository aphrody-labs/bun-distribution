#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { symbolSvgPath } from "@aphrody/material-design-icons";

const ROOT = join(import.meta.dir, "../../..");
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

const server = new McpServer({ name: "aphrody-m3", version: "1.0.0" });

server.tool("m3_list_packages", "List the aphrody-m3 workspace packages with versions.", {}, async () => {
  const dir = join(ROOT, "packages");
  const rows = readdirSync(dir).flatMap((d) => {
    const p = join(dir, d, "package.json");
    if (!existsSync(p)) return [];
    const j = JSON.parse(readFileSync(p, "utf8"));
    return [`${j.name}@${j.version ?? "0.0.0"}  packages/${d}`];
  });
  return text(rows.join("\n"));
});

server.tool(
  "m3_symbol_svg",
  "Return path and SVG source of a Material Symbol from the forked catalogue.",
  { name: z.string(), style: z.enum(["outlined", "rounded", "sharp"]).default("outlined"), weight: z.number().default(400), filled: z.boolean().default(false) },
  async ({ name, style, weight, filled }) => {
    const p = symbolSvgPath(name, style, weight, filled);
    return existsSync(p) ? text(`${p}\n${readFileSync(p, "utf8")}`) : text(`not found: ${p}`);
  },
);

server.tool(
  "m3_svg_to_ico",
  "Generate Tauri desktop icons (ico, icns, png) from a symbol name or SVG file.",
  { input: z.string(), out: z.string().default("src-tauri/icons"), style: z.string().default("outlined"), fill: z.string().optional() },
  async ({ input, out, style, fill }) => {
    const args = ["bun", join(ROOT, "packages/material-design-icons/scripts/svg-to-ico.ts"), input, "--out", out, "--style", style];
    if (fill) args.push("--fill", fill);
    const r = Bun.spawnSync(args);
    return text(`${r.exitCode}\n${r.stdout}${r.stderr}`);
  },
);

await server.connect(new StdioServerTransport());
