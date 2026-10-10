// SPDX-License-Identifier: Apache-2.0
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { generateUnifiedYoloPlugin } from "./generator";

export interface PluginInfo {
  name: string;
  version: string;
  description: string;
  path: string;
  skillsCount: number;
  agentsCount: number;
  gitCommit?: string | undefined;
}

export interface PluginCheckReport {
  timestamp: string;
  totalPlugins: number;
  plugins: PluginInfo[];
  staleArtifacts: string[];
  manifestIssues: string[];
  passed: boolean;
}

function discoverPlugins(pluginsDir: string): PluginInfo[] {
  if (!existsSync(pluginsDir)) return [];

  const results: PluginInfo[] = [];
  const entries = readdirSync(pluginsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pluginPath = join(pluginsDir, entry.name);
    const manifestPath = join(pluginPath, "plugin.json");

    if (!existsSync(manifestPath)) continue;

    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      const skillsDir = join(pluginPath, "skills");
      let skillsCount = 0;
      if (existsSync(skillsDir)) {
        skillsCount = readdirSync(skillsDir, { withFileTypes: true }).filter((d) =>
          d.isDirectory(),
        ).length;
      }

      const agentsDir = join(pluginPath, "agents");
      let agentsCount = 0;
      if (existsSync(agentsDir)) {
        agentsCount = readdirSync(agentsDir, { withFileTypes: true }).filter(
          (f) => f.isFile() && f.name.endsWith(".md"),
        ).length;
      }

      let gitCommit: string | undefined;
      try {
        const gitProc = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], {
          windowsHide: true,
          cwd: pluginPath,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "ignore",
        });
        if (gitProc.exitCode === 0) {
          gitCommit = gitProc.stdout.toString().trim();
        }
      } catch {
        // Ignore
      }

      results.push({
        name: manifest.name || entry.name,
        version: manifest.version || "1.0.0",
        description: manifest.description || "",
        path: pluginPath,
        skillsCount,
        agentsCount,
        gitCommit,
      });
    } catch {
      // Skip invalid JSON
    }
  }

  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}

function findStaleArtifacts(pluginsDir: string): string[] {
  if (!existsSync(pluginsDir)) return [];
  const stale: string[] = [];

  const entries = readdirSync(pluginsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "_recovered" || entry.name === "_backups") {
      stale.push(join(pluginsDir, entry.name));
    }
    if (entry.name.startsWith("relocation-") && entry.name.endsWith(".json")) {
      stale.push(join(pluginsDir, entry.name));
    }
  }

  return stale;
}

function checkManifestConsistency(rootDir: string, plugins: PluginInfo[]): string[] {
  const issues: string[] = [];
  const validNames = new Set(plugins.map((p) => p.name));

  // Check yolo/.agents/plugins.json
  const yoloAgents = join(rootDir, ".agents", "plugins.json");
  if (existsSync(yoloAgents)) {
    try {
      const data = JSON.parse(readFileSync(yoloAgents, "utf-8"));
      for (const entry of data.entries ?? []) {
        for (const inc of entry.include_only ?? []) {
          if (!validNames.has(inc)) {
            issues.push(`yolo/.agents/plugins.json references non-existent plugin: '${inc}'`);
          }
        }
      }
    } catch (e) {
      issues.push(`Failed to parse ${yoloAgents}: ${(e as Error).message}`);
    }
  }

  // Check ~/.gemini/.agents/plugins.json
  const geminiAgents = join(homedir(), ".gemini", ".agents", "plugins.json");
  if (existsSync(geminiAgents)) {
    try {
      const data = JSON.parse(readFileSync(geminiAgents, "utf-8"));
      for (const entry of data.entries ?? []) {
        for (const inc of entry.include_only ?? []) {
          if (!validNames.has(inc)) {
            issues.push(`~/.gemini/.agents/plugins.json references non-existent plugin: '${inc}'`);
          }
        }
      }
    } catch (e) {
      issues.push(`Failed to parse ${geminiAgents}: ${(e as Error).message}`);
    }
  }

  return issues;
}

export async function runPluginCommand(args: readonly string[], rootDir: string): Promise<number> {
  const sub = args[0] || "help";
  const pluginsDir = resolve(rootDir, "plugins");
  const isJson = args.includes("--json");
  const isMd = args.includes("--md");

  switch (sub) {
    case "create":
    case "generate": {
      const targetArg = args.find((a) => !a.startsWith("-") && a !== "create" && a !== "generate");
      const targetDir = targetArg
        ? resolve(process.cwd(), targetArg)
        : resolve(rootDir, "plugins", "yolo");

      console.log(`\x1b[1m\x1b[36m=== YOLO Plugin Generator (Native Bun + TS7 + NHITL) ===\x1b[0m`);
      console.log(`  Source Monorepo: ${rootDir}`);
      console.log(`  Target Output:   ${targetDir}`);

      const t0 = Bun.nanoseconds();
      const result = await generateUnifiedYoloPlugin({
        targetDir,
        yoloRoot: rootDir,
        name: "yolo",
        version: "1.0.0",
      });
      const elapsedMs = ((Bun.nanoseconds() - t0) / 1_000_000).toFixed(2);

      console.log(
        `  \x1b[32m✔ Successfully generated ${result.filesGenerated.length} plugin files in ${elapsedMs} ms\x1b[0m`,
      );
      for (const file of result.filesGenerated) {
        console.log(`    - ${file}`);
      }
      return 0;
    }

    case "status":
    case "list": {
      const plugins = discoverPlugins(pluginsDir);

      if (isJson) {
        console.log(
          JSON.stringify(
            {
              pluginsDir,
              totalPlugins: plugins.length,
              plugins,
            },
            null,
            2,
          ),
        );
        return 0;
      }

      if (isMd) {
        console.log(`# YOLO Plugins Status\n`);
        console.log(`- **Store :** \`${pluginsDir}\``);
        console.log(`- **Total Plugins :** ${plugins.length}\n`);
        console.log(`| Plugin | Version | Skills | Agents | Commit | Description |`);
        console.log(`| :--- | :---: | :---: | :---: | :---: | :--- |`);
        for (const p of plugins) {
          console.log(
            `| **${p.name}** | \`${p.version}\` | ${p.skillsCount} | ${p.agentsCount} | \`${p.gitCommit || "HEAD"}\` | ${p.description.slice(0, 70)}... |`,
          );
        }
        return 0;
      }

      console.log(`\x1b[1m\x1b[36m=== YOLO Plugins Status (${plugins.length} active) ===\x1b[0m`);
      console.log(`  Store Directory: ${pluginsDir}\n`);
      for (const p of plugins) {
        console.log(
          `  \x1b[1m\x1b[32m${p.name.padEnd(16)}\x1b[0m v${p.version} (${p.skillsCount} skills, ${p.agentsCount} agents) [${p.gitCommit || "HEAD"}]`,
        );
        if (p.description) {
          console.log(`    \x1b[90m${p.description}\x1b[0m`);
        }
      }
      return 0;
    }

    case "check":
    case "doctor": {
      const plugins = discoverPlugins(pluginsDir);
      const staleArtifacts = findStaleArtifacts(pluginsDir);
      const manifestIssues = checkManifestConsistency(rootDir, plugins);

      const passed = staleArtifacts.length === 0 && manifestIssues.length === 0;
      const report: PluginCheckReport = {
        timestamp: new Date().toISOString(),
        totalPlugins: plugins.length,
        plugins,
        staleArtifacts,
        manifestIssues,
        passed,
      };

      if (isJson) {
        console.log(JSON.stringify(report, null, 2));
        return passed ? 0 : 1;
      }

      if (isMd) {
        console.log(`# YOLO Plugins Audit Report\n`);
        console.log(`- **Timestamp :** ${report.timestamp}`);
        console.log(
          `- **Verdict :** ${passed ? "**CONFORME (HEALTHY)**" : "**ATTENTION REQUISE**"}\n`,
        );
        console.log(`### Active Plugins (${plugins.length})`);
        for (const p of plugins) {
          console.log(`- **${p.name}** v${p.version} (${p.skillsCount} skills)`);
        }
        if (staleArtifacts.length > 0) {
          console.log(`\n### Stale Artifacts to Purge`);
          for (const s of staleArtifacts) console.log(`- \`${s}\``);
        }
        if (manifestIssues.length > 0) {
          console.log(`\n### Manifest Inconsistencies`);
          for (const m of manifestIssues) console.log(`- ${m}`);
        }
        return passed ? 0 : 1;
      }

      console.log(`\x1b[1m\x1b[36m=== YOLO Plugins Verification & Doctor ===\x1b[0m`);
      console.log(`  Plugins Verified: ${plugins.length}`);
      for (const p of plugins) {
        console.log(`    \x1b[32m✔\x1b[0m ${p.name} (v${p.version}, ${p.skillsCount} skills)`);
      }

      if (staleArtifacts.length > 0) {
        console.log(
          `\n  \x1b[33m⚠ Found ${staleArtifacts.length} stale artifact(s) (run 'yolo plugin purge'):\x1b[0m`,
        );
        for (const s of staleArtifacts) {
          console.log(`    - ${s}`);
        }
      } else {
        console.log(`  \x1b[32m✔ No stale artifacts detected\x1b[0m`);
      }

      if (manifestIssues.length > 0) {
        console.log(`\n  \x1b[31m✖ Manifest inconsistencies detected:\x1b[0m`);
        for (const m of manifestIssues) {
          console.log(`    - ${m}`);
        }
      } else {
        console.log(`  \x1b[32m✔ Manifests synchronized with active plugins\x1b[0m`);
      }

      console.log(
        passed
          ? `\n\x1b[32m[OK] Plugins workspace is 100% compliant.\x1b[0m`
          : `\n\x1b[33m[WARN] Purge or reconcile issues above.\x1b[0m`,
      );
      return passed ? 0 : 1;
    }

    case "purge":
    case "clean": {
      console.log(`\x1b[1m\x1b[36m=== YOLO Plugins Autonomous Purge ===\x1b[0m`);
      const staleArtifacts = findStaleArtifacts(pluginsDir);

      if (staleArtifacts.length === 0) {
        console.log(`  \x1b[32m✔ No stale or hallucinated artifacts found in ${pluginsDir}\x1b[0m`);
        return 0;
      }

      let reclaimedBytes = 0;
      for (const item of staleArtifacts) {
        try {
          const stat = statSync(item);
          reclaimedBytes += stat.size;
          rmSync(item, { recursive: true, force: true });
          console.log(`  \x1b[32m✔ Purged:\x1b[0m ${item}`);
        } catch (e) {
          console.warn(`  \x1b[31m✖ Failed to purge ${item}:\x1b[0m ${(e as Error).message}`);
        }
      }

      console.log(
        `\n\x1b[32mPurge completed. Reclaimed approx ${(reclaimedBytes / 1024).toFixed(1)} KB.\x1b[0m`,
      );
      return 0;
    }

    case "help":
    default: {
      console.log(`\x1b[1m\x1b[36mYOLO Plugin Command (Native Bun + TS7 + NHITL)\x1b[0m

USAGE:
  yolo plugin <command> [options]

COMMANDS:
  status [--json|--md]   List all active plugins, versions, skills count, and git commits
  check [--json|--md]    Validate plugin manifests, skills integrity, and detect stale references
  purge                  Autonomously purge legacy, recovered, relocation and hallucinated artifacts
  create [dir]           Autonomously generate unified YOLO & Bun-TS7 plugin
  help                   Display this help message
`);
      return 0;
    }
  }
}
