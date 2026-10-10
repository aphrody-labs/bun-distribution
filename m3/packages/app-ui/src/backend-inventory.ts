// SPDX-License-Identifier: Apache-2.0
import { aphrodyRpc, ensureAphrodyInitialized } from "./tauri-bridge";

export interface AgentTool {
  name: string;
  description: string;
}
export interface AgentServer {
  name: string;
  status: string;
}
export interface AgentInventory {
  tools: AgentTool[];
  servers: AgentServer[];
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Inventaire du service invalide.");
  }
  return value as Record<string, unknown>;
}

export function parseAgentInventory(
  toolResponse: unknown,
  serverResponse: unknown,
): AgentInventory {
  const tools = record(toolResponse).data;
  const servers = record(serverResponse).servers;
  if (!Array.isArray(tools) || !Array.isArray(servers))
    throw new Error("Inventaire du service incomplet.");
  return {
    tools: tools.map((entry: unknown) => {
      const tool = record(entry);
      if (typeof tool.name !== "string" || !tool.name.trim()) throw new Error("Outil sans nom.");
      return {
        name: tool.name,
        description: typeof tool.description === "string" ? tool.description : "",
      };
    }),
    servers: servers.map((entry: unknown) => {
      const server = record(entry);
      if (typeof server.name !== "string" || typeof server.status !== "string")
        throw new Error("État du serveur incomplet.");
      return { name: server.name, status: server.status };
    }),
  };
}

export async function loadAgentInventory(): Promise<AgentInventory> {
  await ensureAphrodyInitialized();
  const [tools, servers] = await Promise.all([
    aphrodyRpc("tools/list"),
    aphrodyRpc("mcpServerStatus/list"),
  ]);
  return parseAgentInventory(tools, servers);
}
