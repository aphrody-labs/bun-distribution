#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/** Steam MCP server over stdio (newline-delimited JSON-RPC 2.0). */
import { openSteamDb } from "./db.ts";
import { opClassify, opRea, opScan, opSql, opStats } from "./ops.ts";
import { syncApiCatalog } from "./webapi.ts";

const str = { type: "string" } as const;
const common = { db: str, root: str };
const TOOLS: Record<
  string,
  {
    description: string;
    schema: object;
    run: (a: any) => unknown | Promise<unknown>;
  }
> = {
  steam_scan: {
    description: "Index the local Steam install into SQLite",
    schema: { ...common, hashMax: { type: "number" } },
    run: (a) => opScan(a),
  },
  steam_stats: {
    description: "Row counts per table of the Steam database",
    schema: common,
    run: (a) => opStats(a),
  },
  steam_sql: {
    description: "Run a read-only SELECT on the Steam database",
    schema: { ...common, sql: str },
    run: (a) => opSql(a, a.sql),
  },
  steam_api_sync: {
    description: "Index Steam Web API interfaces/methods/params/endpoints",
    schema: common,
    run: async (a) => {
      const db = openSteamDb(a.db);
      try {
        return await syncApiCatalog(db);
      } finally {
        db.close();
      }
    },
  },
  steam_classify: {
    description: "Detect the file type of a path",
    schema: { path: str },
    run: (a) => opClassify(a.path),
  },
  steam_rea: {
    description: "Run the RE pipeline on an installed app executable",
    schema: { ...common, appid: { type: "number" }, outdir: str },
    run: (a) => opRea(a, a.appid, a.outdir),
  },
};

const send = (m: unknown) =>
  process.stdout.write(
    `${JSON.stringify(m, (_, v) => (typeof v === "bigint" ? v.toString() : v))}\n`,
  );

async function handle(req: any): Promise<void> {
  const { id, method, params } = req;
  const ok = (result: unknown): void =>
    void (id !== undefined && send({ jsonrpc: "2.0", id, result }));
  const fail = (code: number, message: string): void =>
    void (
      id !== undefined && send({ jsonrpc: "2.0", id, error: { code, message } })
    );
  switch (method) {
    case "initialize":
      return ok({
        protocolVersion: params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "steam", version: "1.4.4" },
      });
    case "ping":
      return ok({});
    case "tools/list":
      return ok({
        tools: Object.entries(TOOLS).map(([name, t]) => ({
          name,
          description: t.description,
          inputSchema: { type: "object", properties: t.schema },
        })),
      });
    case "tools/call": {
      const tool = TOOLS[params?.name];
      if (!tool) return fail(-32602, `unknown tool ${params?.name}`);
      try {
        const out = await tool.run(params.arguments ?? {});
        return ok({
          content: [
            {
              type: "text",
              text: JSON.stringify(out, (_, v) =>
                typeof v === "bigint" ? v.toString() : v,
              ),
            },
          ],
        });
      } catch (e) {
        return ok({
          isError: true,
          content: [
            { type: "text", text: e instanceof Error ? e.message : String(e) },
          ],
        });
      }
    }
    default:
      if (!method?.startsWith("notifications/"))
        fail(-32601, `method not found: ${method}`);
  }
}

let buf = "";
for await (const chunk of Bun.stdin.stream()) {
  buf += Buffer.from(chunk).toString("utf8");
  let nl: number;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line)
      await handle(JSON.parse(line)).catch((e) =>
        send({
          jsonrpc: "2.0",
          error: { code: -32603, message: String(e) },
          id: null,
        }),
      );
  }
}
