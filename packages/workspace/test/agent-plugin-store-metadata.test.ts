// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { plugins, prepareStore, readJson } from "../src/agent-plugin-store.ts";

test("preparation preserves fusion version, canonical MCP and idempotence", () => {
  const root = mkdtempSync(join(tmpdir(), "plugin-fusion-"));
  try {
    const path = join(root, "aphrody");
    mkdirSync(join(path, ".claude-plugin"), { recursive: true });
    mkdirSync(join(path, "hooks/scripts"), { recursive: true });
    writeFileSync(
      join(path, "hooks/scripts/session-context.ts"),
      "console.log('{}');\n",
    );
    writeFileSync(
      join(path, "hooks/hooks.json"),
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command:
                    'bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/session-start.sh"',
                },
                { type: "command", command: "custom-existing-hook" },
              ],
            },
          ],
          PermissionRequest: [
            {
              hooks: [
                {
                  type: "command",
                  command:
                    'bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/permission-allow.sh"',
                },
              ],
            },
          ],
        },
      }),
    );
    writeFileSync(
      join(path, "plugin.json"),
      JSON.stringify({
        name: "aphrody",
        version: "2.2.1",
        description: "stale",
      }),
    );
    writeFileSync(
      join(path, ".claude-plugin/plugin.json"),
      JSON.stringify({
        name: "aphrody",
        version: "2.3.0",
        description: "fused",
        lspServers: { rust: { command: "rust-analyzer" } },
      }),
    );
    writeFileSync(
      join(path, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          aphrody: { command: "aphrody", args: ["kernel", "mcp"] },
        },
      }),
    );
    expect(plugins(root)[0]?.version).toBe("2.3.0");
    const before = readJson(join(path, "plugin.json"));
    expect(prepareStore(root, "fixture", false).length).toBeGreaterThan(0);
    expect(readJson(join(path, "plugin.json"))).toEqual(before);
    prepareStore(root, "fixture", true);
    expect(readJson(join(path, "plugin.json")).version).toBe("2.3.0");
    expect(readJson(join(path, ".codex-plugin/plugin.json")).version).toBe(
      "2.3.0",
    );
    expect(
      readJson(join(path, ".claude-plugin/plugin.json")).lspServers,
    ).toEqual({
      rust: { command: "rust-analyzer" },
    });
    expect(readJson(join(path, ".mcp.json")).mcpServers).toEqual({
      aphrody: { type: "stdio", command: "aphrody-mcp", args: [] },
    });
    const hooks = readJson(join(path, "hooks/hooks.json")).hooks as Record<
      string,
      unknown
    >;
    expect(hooks.PermissionRequest).toBeUndefined();
    expect(JSON.stringify(hooks)).toContain(
      "bun --no-install --no-env-file run",
    );
    expect(JSON.stringify(hooks)).toContain("custom-existing-hook");
    expect(JSON.stringify(readJson(join(path, "hooks.json")))).not.toContain(
      "CLAUDE_PLUGIN_ROOT",
    );
    expect(prepareStore(root, "fixture", false)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
