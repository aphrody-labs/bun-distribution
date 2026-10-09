import { TOOLS } from "../tools/registry";

/**
 * OpenAPI 3.1 schema specification for the YOLO micro-server.
 */

export function buildOpenApiSpec(version: string, bunVersion: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "YOLO Industrial Engine API",
      version,
      description: `Native Bun-powered REST API for YOLO monorepo and runtime (Bun ${bunVersion})`,
    },
    paths: {
      "/health": {
        get: {
          summary: "Service health and version check",
          responses: { "200": { description: "Health status" } },
        },
      },
      "/api/status": {
        get: {
          summary: "Monorepo submodule and cargo status",
          responses: { "200": { description: "Status report" } },
        },
      },
      "/api/doctor": {
        get: {
          summary: "Environment, stack toolchain and runtime diagnostics",
          responses: { "200": { description: "Doctor diagnostics" } },
        },
      },
      "/api/bench": {
        get: {
          summary: "Run native Bun micro-benchmark",
          parameters: [
            { name: "iterations", in: "query", schema: { type: "integer", default: 200000 } },
          ],
          responses: { "200": { description: "Benchmark results" } },
        },
      },
      "/api/scan": {
        post: {
          summary: "Recursively scan target directory in parallel",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    path: { type: "string" },
                    exts: { type: "string" },
                    parallel: { type: "integer", minimum: 1, maximum: 256 },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Scan results" } },
        },
      },
      "/api/parse": {
        post: {
          summary: "Parse source inside the workspace",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: TOOLS.find((tool) => tool.name === "yolo_parse")!.inputSchema,
              },
            },
          },
          responses: {
            "200": { description: "Source analysis" },
            "400": { description: "Invalid arguments" },
          },
        },
      },
      "/api/verify": {
        post: {
          summary: "Run selected gates and their prerequisites",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: TOOLS.find((tool) => tool.name === "yolo_verify")!.inputSchema,
              },
            },
          },
          responses: {
            "200": { description: "Gate report" },
            "400": { description: "Invalid arguments" },
          },
        },
      },
      "/api/tools/call": {
        post: {
          summary: "Execute a native MCP tool",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  oneOf: TOOLS.map((tool) => ({
                    type: "object",
                    required: ["name"],
                    properties: { name: { const: tool.name }, arguments: tool.inputSchema },
                  })),
                },
              },
            },
          },
          responses: {
            "200": { description: "Structured tool result" },
            "400": { description: "Invalid arguments" },
            "401": { description: "Token required" },
          },
        },
      },
      "/api/tools": {
        get: {
          summary: "List all MCP tools available through API",
          responses: { "200": { description: "Tool definitions list" } },
        },
      },
    },
  };
}
