/** Native Bun HTTP transport sharing the capability owner and OpenAPI contract. */
import { yoloHome, yoloVersion } from "../vfs/home";
import { hostTarget } from "@aphrody/runtime-sdk/src/artifact.ts";
import {
  TOOLS,
  executeTool,
  isRecord,
  validateToolArguments,
  ToolArgumentError,
  ToolExecutionContext,
} from "../tools/registry";
import { resolveContainedPath } from "../tools/paths";
import { buildOpenApiSpec } from "./openapi";
export { buildOpenApiSpec } from "./openapi";

export interface ApiServerOptions {
  readonly port?: number;
  readonly hostname?: string;
  readonly rootDir?: string;
  readonly token?: string | undefined;
  readonly toolContext?: ToolExecutionContext | undefined;
}

export function safeResolvePath(rootDir: string, subPath?: string): string {
  return resolveContainedPath(rootDir, subPath);
}

function loopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      url.origin === origin
    );
  } catch {
    return false;
  }
}

function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(data, {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

export function createApiServer(options: ApiServerOptions = {}) {
  const rootDir = options.rootDir ?? yoloHome();
  const hostname = options.hostname ?? "127.0.0.1";
  const requiredToken = options.token ?? Bun.env.YOLO_API_TOKEN;
  const context = options.toolContext ?? new ToolExecutionContext({ containPaths: true });
  const server = Bun.serve({
    port: options.port ?? 8999,
    hostname,
    async fetch(req) {
      let requestHost: string;
      try {
        requestHost = new URL(`http://${req.headers.get("host") ?? ""}`).hostname;
      } catch {
        return jsonResponse({ error: "Invalid Host header (DNS rebinding protection)" }, 403);
      }
      if (!["127.0.0.1", "localhost", "[::1]", hostname.toLowerCase()].includes(requestHost.toLowerCase())) {
        return jsonResponse({ error: "Invalid Host header (DNS rebinding protection)" }, 403);
      }
      const origin = req.headers.get("origin");
      const corsHeaders: Record<string, string> =
        origin && loopbackOrigin(origin)
          ? {
              "Access-Control-Allow-Origin": origin,
              "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type, Authorization, X-YOLO-Token",
              Vary: "Origin",
            }
          : {};
      if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
      if (req.method === "POST" && origin && !loopbackOrigin(origin)) {
        return jsonResponse({ error: "Untrusted request origin" }, 403, corsHeaders);
      }
      if (req.method === "POST" && requiredToken) {
        const auth = req.headers.get("authorization");
        const provided = req.headers.get("x-yolo-token") ?? (auth?.startsWith("Bearer ") ? auth.slice(7) : null);
        if (provided !== requiredToken)
          return jsonResponse({ error: "Unauthorized: valid Bearer or X-YOLO-Token required" }, 401, corsHeaders);
      }
      const url = new URL(req.url);
      const path = url.pathname;
      const readBody = async (): Promise<Record<string, unknown>> => {
        let value: unknown;
        try {
          value = await req.json();
        } catch {
          throw new ToolArgumentError("Request body must be valid JSON");
        }
        if (!isRecord(value)) throw new ToolArgumentError("Request body must be an object");
        return value;
      };
      // Enforce HTTP containment even when dependencies are supplied by the caller.
      const call = async (name: string, args: Record<string, unknown>) => {
        validateToolArguments(name, args);
        if (["yolo_scan", "yolo_parse", "yolo_package_sync", "yolo_n2b_scan"].includes(name)) {
          if (args.path !== undefined && typeof args.path !== "string")
            throw new ToolArgumentError("path must be a string");
          args = {
            ...args,
            path: safeResolvePath(rootDir, args.path as string | undefined),
          };
        } else if (name === "yolo_host_space" && typeof args.dir === "string") {
          args = { ...args, dir: safeResolvePath(rootDir, args.dir) };
        }
        return executeTool(name, args, rootDir, context, {
          signal: req.signal,
        });
      };
      try {
        if (["/", "/health", "/api/health"].includes(path) && req.method === "GET") {
          return jsonResponse(
            {
              status: "ok",
              uptimeSec: Math.round(process.uptime()),
              timestamp: new Date().toISOString(),
              yoloVersion: yoloVersion(),
              bunVersion: Bun.version,
              hostTarget: hostTarget(),
            },
            200,
            corsHeaders,
          );
        }
        if (path === "/api/openapi.json" && req.method === "GET")
          return jsonResponse(buildOpenApiSpec(yoloVersion(), Bun.version), 200, corsHeaders);
        if (path === "/api/tools" && req.method === "GET")
          return jsonResponse({ schema: "yolo.tools/1", tools: TOOLS }, 200, corsHeaders);
        if (path === "/api/bench" && req.method === "GET") {
          return jsonResponse(
            await call("yolo_bench", {
              iterations: Number(url.searchParams.get("iterations") ?? 200000),
            }),
            200,
            corsHeaders,
          );
        }
        if (path === "/api/status" && req.method === "GET")
          return jsonResponse(await call("yolo_status", {}), 200, corsHeaders);
        if (path === "/api/doctor" && req.method === "GET")
          return jsonResponse(await call("yolo_doctor", {}), 200, corsHeaders);
        if (req.method === "POST") {
          const routes: Record<string, string> = {
            "/api/scan": "yolo_scan",
            "/api/parse": "yolo_parse",
            "/api/verify": "yolo_verify",
          };
          const route = routes[path];
          if (route) return jsonResponse(await call(route, await readBody()), 200, corsHeaders);
          if (path === "/api/tools/call") {
            const body = await readBody();
            if (typeof body.name !== "string" || (body.arguments !== undefined && !isRecord(body.arguments)))
              throw new ToolArgumentError("Provide tool name and object arguments");
            return jsonResponse(
              await call(body.name, (body.arguments ?? {}) as Record<string, unknown>),
              200,
              corsHeaders,
            );
          }
        }
        return jsonResponse({ error: `Not found: ${path}` }, 404, corsHeaders);
      } catch (error) {
        return jsonResponse(
          { error: error instanceof Error ? error.message : String(error) },
          error instanceof ToolArgumentError ? 400 : 500,
          corsHeaders,
        );
      }
    },
  });
  const stop = server.stop.bind(server);
  server.stop = (closeActiveConnections?: boolean) => {
    if (!options.toolContext) context.close();
    return stop(closeActiveConnections);
  };
  return server;
}

export async function runApiCommand(args: readonly string[], rootDir: string = yoloHome()): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`\x1b[1m\x1b[36m=== YOLO API Server ===\x1b[0m
Native Bun HTTP REST and OpenAPI micro-server for YOLO tools.

\x1b[1mUsage:\x1b[0m
  yolo api [options]

\x1b[1mOptions:\x1b[0m
  --port, -p <number>     Port to bind (default: 8999)
  --host, --hostname <ip> Host to bind (default: 127.0.0.1)
  --token <string>        Authorization token required for POST endpoints (or YOLO_API_TOKEN env)
  --allow-remote          Allow non-loopback interface binding without token
  --help, -h              Show this help message
`);
    return 0;
  }

  const getOpt = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };

  const portOpt = getOpt("--port") ?? getOpt("-p");
  const hostOpt = getOpt("--host") ?? getOpt("--hostname");
  const tokenOpt = getOpt("--token") ?? Bun.env.YOLO_API_TOKEN;
  const allowRemote = args.includes("--allow-remote");

  const port = portOpt ? parseInt(portOpt, 10) : 8999;
  const hostname = hostOpt ?? "127.0.0.1";

  const isLoopback = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  if (!isLoopback && !tokenOpt && !allowRemote) {
    console.error(
      `\x1b[31mError:\x1b[0m Refusing to bind non-loopback host '${hostname}' without authentication. Use --token <secret> or --allow-remote.`,
    );
    return 1;
  }

  const server = createApiServer({ port, hostname, rootDir, token: tokenOpt });
  console.log(`\x1b[1m\x1b[36m=== YOLO API Server ===\x1b[0m`);
  console.log(`  Listening on: http://${server.hostname}:${server.port}`);
  console.log(`  Health:       http://${server.hostname}:${server.port}/health`);
  console.log(`  OpenAPI:      http://${server.hostname}:${server.port}/api/openapi.json`);
  console.log(`  Tools:        http://${server.hostname}:${server.port}/api/tools`);
  if (tokenOpt) {
    console.log(`  Security:     Token authentication active on mutating POST endpoints`);
  }
  console.log(`  Press Ctrl+C to stop.`);

  return new Promise<number>((resolve, reject) => {
    let stopping = false;
    const shutdown = async () => {
      if (stopping) return;
      stopping = true;
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      try {
        await server.stop();
        resolve(0);
      } catch (error) {
        reject(error);
      }
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}
