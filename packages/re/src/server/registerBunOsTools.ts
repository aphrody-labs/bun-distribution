// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import type { Stage, TargetKind } from "../pipeline/contract.js";
import { listAdapters, runPipeline } from "../pipeline/runner.js";
import { openSteamDb } from "../steam/db.js";
import {
  opClassify,
  opRea,
  opScan,
  opSql,
  opStats,
  type CommonOptions,
} from "../steam/ops.js";
import { syncApiCatalog } from "../steam/webapi.js";

type ToolText = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

const json = (value: unknown): string =>
  typeof value === "string"
    ? value
    : JSON.stringify(value, (_, v) =>
        typeof v === "bigint" ? v.toString() : v,
      );

const run = async (work: () => unknown): Promise<ToolText> => {
  try {
    return { content: [{ type: "text", text: json(await work()) }] };
  } catch (cause) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: cause instanceof Error ? cause.message : String(cause),
        },
      ],
    };
  }
};

const steamDatabase = {
  db: z.string().optional().describe("Steam SQLite database path"),
  root: z.string().optional().describe("Steam install root"),
};

const common = (args: {
  db?: string | undefined;
  root?: string | undefined;
}): CommonOptions => ({
  db: args.db,
  root: args.root,
});

/** Steam indexer and cross-OS RE pipeline tools, served by the one RE MCP server. */
export const registerBunOsTools = (server: EvidenceMcpServer): void => {
  const tool = <Shape extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: Shape,
    handler: (args: z.infer<z.ZodObject<Shape>>) => unknown,
  ): void => {
    server.registerTool(
      name,
      { description, inputSchema: z.object(shape) } as never,
      ((args: z.infer<z.ZodObject<Shape>>) =>
        run(() => handler(args))) as never,
    );
  };

  tool(
    "steam_scan",
    "Index the local Steam install into SQLite",
    { ...steamDatabase, hashMax: z.number().optional() },
    (a) => opScan({ ...common(a), hashMax: a.hashMax }),
  );
  tool(
    "steam_stats",
    "Row counts per table of the Steam database",
    steamDatabase,
    (a) => opStats(common(a)),
  );
  tool(
    "steam_sql",
    "Run a read-only SELECT on the Steam database",
    { ...steamDatabase, sql: z.string() },
    (a) => opSql(common(a), a.sql),
  );
  tool(
    "steam_api_sync",
    "Index Steam Web API interfaces, methods, parameters and endpoints",
    steamDatabase,
    async (a) => {
      const db = openSteamDb(a.db);
      try {
        return await syncApiCatalog(db);
      } finally {
        db.close();
      }
    },
  );
  tool(
    "steam_classify",
    "Detect the file type of a path",
    { path: z.string() },
    (a) => opClassify(a.path),
  );
  tool(
    "steam_rea",
    "Run the RE pipeline on an installed Steam app executable",
    { ...steamDatabase, appid: z.number(), outdir: z.string().optional() },
    (a) => opRea(common(a), a.appid, a.outdir),
  );
  tool(
    "re_pipeline_run",
    "Run the cross-OS/BIOS/firmware RE pipeline (acquire, identify, unpack, analyze, lift, decompile, rebuild, verify) on a local file. Returns the typed PipelineReport; unavailable stages list candidate adapters.",
    {
      input: z.string().describe("Path of the binary, ROM, firmware or image"),
      target: z.enum(["os", "bios", "firmware"]).optional(),
      outdir: z.string().describe("Output directory"),
      external: z
        .boolean()
        .optional()
        .describe("Enable heavy external adapters (Ghidra headless)"),
      trace: z
        .boolean()
        .optional()
        .describe("Execute the rebuilt binary for a bounded trace"),
    },
    (a) =>
      runPipeline(a.input, {
        target: (a.target ?? "os") as TargetKind,
        outdir: a.outdir,
        external: a.external ?? false,
        trace: a.trace ?? false,
      }),
  );
  tool(
    "re_pipeline_adapters",
    "List registered pipeline stage adapters with live availability (ready, registered, unavailable) and owners.",
    { stage: z.string().optional() },
    (a) => listAdapters(a.stage as Stage | undefined),
  );
};
