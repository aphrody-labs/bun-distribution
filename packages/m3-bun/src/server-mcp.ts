// SPDX-License-Identifier: Apache-2.0
// The M3 design tools of `@aphrody/m3-mcp` over HTTP, in the shapes of its tool-host protocol (the one the single
// Aphrody MCP server speaks to it): `GET /api/m3/mcp` lists the tools (`tool-host list`), `POST /api/m3/mcp/<tool>` with
// the JSON arguments runs one (`tool-host call`) and answers `{content, isError?}`. The tools run in this process
// (loaded on the first request), or, with `isolate`, in a `tool-host` child per call so their dependencies never load
// into the server.
import type { M3Routes } from "./api.ts";
import { loadOptional } from "./server-optional.ts";

type M3Mcp = typeof import("@aphrody/m3-mcp");
type ToolResult = Awaited<ReturnType<M3Mcp["callM3Tool"]>>;

export interface M3McpOptions {
  /** Route prefix (default `/api/m3/mcp`). */
  path?: string;
  /** Run each call in a `@aphrody/m3-mcp/tool-host` child process. */
  isolate?: boolean;
}

const FEATURE = "MCP tools endpoint";
const mcp = () => loadOptional<M3Mcp>("@aphrody/m3-mcp", FEATURE);

async function toolHost(args: string[]): Promise<string> {
  let script: string;
  try {
    script = Bun.resolveSync("@aphrody/m3-mcp/tool-host", import.meta.dir);
  } catch (error) {
    throw new Error(
      `m3-bun ${FEATURE}: cannot resolve @aphrody/m3-mcp/tool-host; add @aphrody/m3-mcp to the app's dependencies`,
      {
        cause: error,
      },
    );
  }
  const child = Bun.spawn([process.execPath, script, ...args], {
    windowsHide: true,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`m3-bun ${FEATURE}: tool-host ${args[0]} exited with ${code}: ${stderr.trim()}`);
  return stdout;
}

/** The routes of the endpoint. */
export function m3McpRoutes(options: M3McpOptions = {}): M3Routes {
  const path = (options.path ?? "/api/m3/mcp").replace(/\/+$/, "");
  const list = async (): Promise<unknown> =>
    options.isolate ? JSON.parse(await toolHost(["list"])) : (await mcp()).listM3Tools();
  const call = async (name: string, args: unknown, signal: AbortSignal): Promise<ToolResult> =>
    options.isolate
      ? (JSON.parse(await toolHost(["call", name, JSON.stringify(args)])) as ToolResult)
      : (await mcp()).callM3Tool(name, args, signal);
  return {
    [path]: { GET: async () => Response.json({ tools: await list() }) },
    [`${path}/:tool`]: {
      POST: async request => {
        let args: unknown = {};
        const text = await request.text();
        if (text.trim() !== "") {
          try {
            args = JSON.parse(text);
          } catch {
            return Response.json(
              {
                content: [{ type: "text", text: "arguments are not JSON" }],
                isError: true,
              },
              { status: 400 },
            );
          }
        }
        const result = await call(request.params.tool!, args, request.signal);
        return Response.json(result, { status: result.isError ? 422 : 200 });
      },
    },
  };
}
