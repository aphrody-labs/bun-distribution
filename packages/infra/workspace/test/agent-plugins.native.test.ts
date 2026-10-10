// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePluginArgs, pluginOperation } from "../src/agent-plugins.ts";
import { prepareStore } from "../src/agent-plugin-store.ts";

// Opt in: these gates exercise installed native CLIs with isolated configuration homes.
for (const provider of ["codex", "claude", "agy"])
  for (const scope of ["user", "project"])
    for (const kind of ["plugin", "skill", "mcp"])
      test.skipIf(process.env.APHRODY_PLUGIN_NATIVE_TESTS !== "1" || !Bun.which(provider))(
        `${provider} ${scope}: install/remove ${kind} in a fresh profile`,
        async () => {
          const root = mkdtempSync(join(tmpdir(), "aphrody-native-plugins-"));
          try {
            const home = join(root, "home"),
              cwd = join(home, "aphrody"),
              store = join(root, "plugins");
            mkdirSync(cwd, { recursive: true });
            const skill = join(store, "example/skills/demo");
            mkdirSync(skill, { recursive: true });
            writeFileSync(
              join(store, "example/plugin.json"),
              JSON.stringify({
                name: "example",
                version: "1.0.0",
                description: "Native qualification fixture",
                author: { name: "aphrody-dev" },
              }),
            );
            writeFileSync(
              join(skill, "SKILL.md"),
              "---\nname: demo\ndescription: Inspect the local fixture.\n---\nFixture.\n",
            );
            prepareStore(store, "aphrody-user", true);
            const mcp = join(root, "mcp.json");
            writeFileSync(mcp, JSON.stringify({ command: "aphrody", args: ["kernel", "mcp"] }));
            const name = kind === "plugin" ? "example" : kind === "skill" ? "demo" : "fixture";
            const args = [
              "--provider",
              provider,
              "--scope",
              scope,
              "--kind",
              kind,
              "--name",
              name,
              "--home",
              home,
              "--cwd",
              cwd,
              "--store",
              store,
              "--apply",
            ];
            if (kind !== "plugin") args.push("--source", kind === "skill" ? skill : mcp);
            const installed = await pluginOperation(parsePluginArgs(["install", ...args]));
            expect(installed.apply).toBe(true);
            const removed = await pluginOperation(parsePluginArgs(["uninstall", ...args]));
            expect(removed.apply).toBe(true);
          } finally {
            rmSync(root, { recursive: true, force: true });
          }
        },
        120000,
      );
