/**
 * `yolo mcp`: Native Model Context Protocol (MCP 2024-11-05) Server.
 * Exposes YOLO CLI tools directly to AI Agents (Antigravity, Claude Code, Gemini CLI, etc.)
 * over stdio JSON-RPC 2.0 with zero external npm dependencies.
 *
 * Implements:
 * - initialize, notifications/initialized, ping
 * - tools/list with strict JSON Schema definitions
 * - tools/call with structured JSON results
 */

import { yoloHome } from "../vfs/home";
import {
  TOOLS,
  executeTool,
  isRecord,
  defaultContext,
  ToolExecutionContext,
} from "../tools/registry";
export * from "../tools/registry";

export const DEFAULT_MCP_PROTOCOL_VERSION = "2024-11-05";
export const SUPPORTED_MCP_PROTOCOL_VERSIONS = ["2024-11-05", "2025-06-18"] as const;
export const MCP_PROTOCOL_VERSION = DEFAULT_MCP_PROTOCOL_VERSION;
export const SERVER_NAME = "yolo-mcp";
export const SERVER_VERSION = "1.0.0";

export async function handleMcpMessage(
  rawMessage: string,
  rootDir: string = yoloHome(),
  context: ToolExecutionContext = defaultContext(rootDir),
): Promise<string | null> {
  let msg: {
    jsonrpc?: string;
    id?: number | string | null;
    method?: string;
    params?: Record<string, unknown>;
  };
  try {
    msg = JSON.parse(rawMessage);
  } catch {
    return JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
  }

  if (
    !isRecord(msg) ||
    msg.jsonrpc !== "2.0" ||
    typeof msg.method !== "string" ||
    (msg.id !== undefined &&
      msg.id !== null &&
      typeof msg.id !== "string" &&
      typeof msg.id !== "number") ||
    (msg.params !== undefined && !isRecord(msg.params))
  ) {
    return JSON.stringify({
      jsonrpc: "2.0",
      id: isRecord(msg) ? (msg.id ?? null) : null,
      error: { code: -32600, message: "Invalid Request: jsonrpc must be '2.0'" },
    });
  }

  // Notifications (no id)
  if (msg.id === undefined || msg.id === null) {
    if (msg.method === "notifications/initialized") {
      // Client ready confirmation
      return null;
    }
    return null;
  }

  const id = msg.id;

  switch (msg.method) {
    case "initialize": {
      const clientVersion = (msg.params as { protocolVersion?: string } | undefined)
        ?.protocolVersion;
      const negotiatedVersion =
        clientVersion &&
        (SUPPORTED_MCP_PROTOCOL_VERSIONS as readonly string[]).includes(clientVersion)
          ? clientVersion
          : DEFAULT_MCP_PROTOCOL_VERSION;

      return JSON.stringify({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: negotiatedVersion,
          serverInfo: {
            name: SERVER_NAME,
            version: SERVER_VERSION,
          },
          capabilities: {
            tools: {},
          },
        },
      });
    }

    case "ping": {
      return JSON.stringify({
        jsonrpc: "2.0",
        id,
        result: {},
      });
    }

    case "tools/list": {
      return JSON.stringify({
        jsonrpc: "2.0",
        id,
        result: {
          tools: TOOLS,
        },
      });
    }

    case "tools/call": {
      const params = msg.params ?? {};
      const toolName = String(params.name ?? "");
      const args = (params.arguments === undefined ? {} : params.arguments) as Record<
        string,
        unknown
      >;

      try {
        const result = await executeTool(toolName, args, rootDir, context);
        return JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          },
        });
      } catch (err) {
        return JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text: (err as Error).message,
              },
            ],
          },
        });
      }
    }

    default: {
      return JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32601,
          message: `Method not found: ${msg.method}`,
        },
      });
    }
  }
}

/**
 * Runs the stdio MCP JSON-RPC event loop.
 */
export async function runMcpServer(rootDir: string = yoloHome()): Promise<void> {
  const stdin = process.stdin;
  let buffer = "";

  stdin.setEncoding("utf8");
  const context = new ToolExecutionContext();

  try {
    for await (const chunk of stdin) {
      buffer += chunk;
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (line.length === 0) continue;

        const response = await handleMcpMessage(line, rootDir, context);
        if (response !== null) {
          process.stdout.write(response + "\n");
        }
      }
    }
    if (buffer.trim()) {
      const response = await handleMcpMessage(buffer.trim(), rootDir, context);
      if (response !== null) process.stdout.write(response + "\n");
    }
  } finally {
    context.close();
  }
}
