// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable no-await-in-loop -- sequential by design: ordered steps, polling and one host after the other */
/** Aphrody MCP server for Omar's agent client: Claude Desktop (JSON file) and Claude Code (its own CLI), plus a real handshake probe. */
import { existsSync, readdirSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { KitPaths } from "./paths.ts";
import type { System } from "./system.ts";

export interface McpSpec {
  command: string;
  args: string[];
}

export const MCP_NAME = "aphrody";

/** Canonical MCP binary; the multicall fallback runs the same server. */
export const mcpSpec = (aphrodyExe: string, mcpExe?: string): McpSpec => ({
  command: mcpExe ?? aphrodyExe,
  args: mcpExe ? [] : ["mcp-server"],
});

export class McpConfigError extends Error {}

/** Folders where Claude Desktop keeps `claude_desktop_config.json` (classic install and Microsoft Store package). */
export function desktopConfigFiles(paths: KitPaths): string[] {
  const files = [join(paths.appData, "Claude", "claude_desktop_config.json")];
  const packages = join(paths.localAppData, "Packages");
  try {
    for (const name of readdirSync(packages)) {
      if (/^(?:Claude|AnthropicPBC\.Claude)/i.test(name))
        files.push(
          join(
            packages,
            name,
            "LocalCache",
            "Roaming",
            "Claude",
            "claude_desktop_config.json",
          ),
        );
    }
  } catch {
    // no Store packages folder
  }
  return files;
}

/** Pure merge: only `mcpServers.aphrody` is set; every other key, server and setting is left as it was. */
export function mergeDesktopConfig(
  existing: string | undefined,
  spec: McpSpec,
): { text: string; changed: boolean } {
  let root: Record<string, unknown> = {};
  if (existing !== undefined && existing.trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(existing);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      )
        throw new Error("objet attendu");
      root = parsed as Record<string, unknown>;
    } catch (error) {
      throw new McpConfigError(
        `le fichier de configuration de Claude Desktop n'est pas du JSON valide (${(error as Error).message}) : je n'y touche pas`,
      );
    }
  }
  const servers =
    typeof root.mcpServers === "object" &&
    root.mcpServers !== null &&
    !Array.isArray(root.mcpServers)
      ? (root.mcpServers as Record<string, unknown>)
      : {};
  const current = servers[MCP_NAME] as
    { command?: unknown; args?: unknown } | undefined;
  const same =
    current !== undefined &&
    current.command === spec.command &&
    JSON.stringify(current.args) === JSON.stringify(spec.args);
  if (same) return { text: existing ?? "", changed: false };
  const next = {
    ...root,
    mcpServers: {
      ...servers,
      [MCP_NAME]: { command: spec.command, args: spec.args },
    },
  };
  return { text: `${JSON.stringify(next, null, 2)}\n`, changed: true };
}

export interface McpConfigResult {
  client: "claude-desktop" | "claude-code";
  state: "configure" | "deja" | "ignore" | "echec";
  detail: string;
}

/** Configure Claude Desktop where it is installed (its folder exists). The previous file is copied aside first. */
export async function configureDesktop(
  paths: KitPaths,
  spec: McpSpec,
  now: Date,
): Promise<McpConfigResult[]> {
  const results: McpConfigResult[] = [];
  for (const file of desktopConfigFiles(paths)) {
    if (!existsSync(dirname(file))) continue;
    try {
      const before = existsSync(file)
        ? await readFile(file, "utf8")
        : undefined;
      const { text, changed } = mergeDesktopConfig(before, spec);
      if (!changed) {
        results.push({ client: "claude-desktop", state: "deja", detail: file });
        continue;
      }
      await mkdir(dirname(file), { recursive: true });
      if (before !== undefined)
        await copyFile(
          file,
          `${file}.avant-aphrody-${now.toISOString().replace(/[-:T]/g, "").slice(0, 14)}`,
        );
      await writeFile(file, text);
      results.push({
        client: "claude-desktop",
        state: "configure",
        detail: file,
      });
    } catch (error) {
      results.push({
        client: "claude-desktop",
        state: "echec",
        detail: (error as Error).message,
      });
    }
  }
  return results;
}

/** Claude Code: ask its own CLI (never edit its state file by hand). */
export async function configureClaudeCode(
  sys: System,
  claudeExe: string | undefined,
  spec: McpSpec,
): Promise<McpConfigResult> {
  if (!claudeExe)
    return {
      client: "claude-code",
      state: "ignore",
      detail: "Claude Code n'est pas installé",
    };
  const known = await sys.run([claudeExe, "mcp", "get", MCP_NAME], {
    timeoutMs: 30_000,
  });
  if (known.code === 0 && known.stdout.includes(spec.command))
    return { client: "claude-code", state: "deja", detail: "déjà déclaré" };
  if (known.code === 0)
    await sys.run([claudeExe, "mcp", "remove", MCP_NAME, "--scope", "user"], {
      timeoutMs: 30_000,
    });
  const added = await sys.run(
    [
      claudeExe,
      "mcp",
      "add",
      "--scope",
      "user",
      MCP_NAME,
      "--",
      spec.command,
      ...spec.args,
    ],
    {
      timeoutMs: 60_000,
    },
  );
  return added.code === 0
    ? {
        client: "claude-code",
        state: "configure",
        detail: "ajouté pour ton compte",
      }
    : {
        client: "claude-code",
        state: "echec",
        detail: (added.stderr || added.stdout).trim().slice(0, 200),
      };
}

export type ClientState = "configure" | "pas-declare" | "aucun";

/** Read-only: is the server declared in Claude Desktop (any installed flavour)? */
export async function desktopState(
  paths: KitPaths,
  spec: McpSpec,
): Promise<ClientState> {
  let found = false;
  for (const file of desktopConfigFiles(paths)) {
    if (!existsSync(dirname(file))) continue;
    found = true;
    try {
      const before = existsSync(file)
        ? await readFile(file, "utf8")
        : undefined;
      if (!mergeDesktopConfig(before, spec).changed) return "configure";
    } catch {
      // unreadable config counts as not declared
    }
  }
  return found ? "pas-declare" : "aucun";
}

/** Read-only: is the server declared in Claude Code? */
export async function claudeCodeState(
  sys: System,
  claudeExe: string | undefined,
  spec: McpSpec,
): Promise<ClientState> {
  if (!claudeExe) return "aucun";
  const known = await sys.run([claudeExe, "mcp", "get", MCP_NAME], {
    timeoutMs: 30_000,
  });
  return known.code === 0 && known.stdout.includes(spec.command)
    ? "configure"
    : "pas-declare";
}

export interface McpProbe {
  ok: boolean;
  tools?: number;
  error?: string;
}

/** Start the server like a client does (initialize, then tools/list over stdio) and count the tools it offers. */
export async function probeMcp(
  spec: McpSpec,
  timeoutMs = 20_000,
): Promise<McpProbe> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([spec.command, ...spec.args], {
      windowsHide: true,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
    });
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  const stdin = proc.stdin;
  if (!stdin || typeof stdin === "number") {
    proc.kill();
    return { ok: false, error: "entrée standard indisponible" };
  }
  const send = (message: unknown) =>
    stdin.write(`${JSON.stringify(message)}\n`);
  const decoder = new TextDecoder();
  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  let buffer = "";
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const readResponse = async (
    id: number,
  ): Promise<Record<string, unknown> | undefined> => {
    for (;;) {
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (line === "") continue;
        try {
          const message = JSON.parse(line) as Record<string, unknown>;
          if (message.id === id) return message;
        } catch {
          // log line on stdout: ignore
        }
      }
      const chunk = await reader.read();
      if (chunk.done) return undefined;
      buffer += decoder.decode(chunk.value, { stream: true });
    }
  };
  try {
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "aphrody-omar", version: "0" },
      },
    });
    stdin.flush();
    const init = await readResponse(1);
    if (!init || init.error)
      return {
        ok: false,
        error: "le serveur n'a pas répondu à la prise de contact",
      };
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    stdin.flush();
    const list = await readResponse(2);
    const tools = (list?.result as { tools?: unknown[] } | undefined)?.tools;
    if (!Array.isArray(tools))
      return { ok: false, error: "le serveur n'a pas donné sa liste d'outils" };
    return { ok: true, tools: tools.length };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  } finally {
    clearTimeout(timer);
    try {
      stdin.end();
    } catch {
      // already closed
    }
    proc.kill();
  }
}
