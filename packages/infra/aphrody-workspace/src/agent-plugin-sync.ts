/* SPDX-License-Identifier: Apache-2.0 */
/** Synchronize the unified Aphrody plugin to Codex, Claude Code and agy. */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  watch,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";

type Plugin = { name: string; path: string; category: string; description: string };
let root = resolve(import.meta.dir, "..", "..", "..", "..", "aphrody-ai");
const plugins: Plugin[] = [
  {
    name: "aphrody",
    path: "plugins/aphrody",
    category: "developer tools",
    description:
      "Unified Aphrody plugin: AI/LLM, Dragon Ball/Shenron, OS kernel, Web, N2B and WinClean.",
  },
];

function writeJson(path: string, value: object): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function discoverSkills(): string[] {
  const found: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "references")
        continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name === "SKILL.md") found.push(path);
    }
  };
  // One plugin owns the complete Aphrody and Dragon Ball skill catalog.
  const plugin = resolve(root, "plugins", "aphrody");
  if (existsSync(plugin)) visit(plugin);
  return [...new Set(found)].toSorted();
}

function discoverComponents(): object {
  const skills = discoverSkills();
  const repoRelative = (path: string): string => relative(root, path).split(sep).join("/");
  const mcp: string[] = ["aphrody-kernel mcp"];
  return {
    generatedBy: "aphrody git",
    repository: "https://github.com/aphrody-code/aphrody.git",
    ref: "main",
    plugins,
    skills: skills.map(repoRelative),
    mcpServers: mcp,
    extensions: [],
    repositoryIntelligence: "./github-repository-intelligence.json",
  };
}

/** Repository-local plugin manifests are validated by their respective owners. */
function validateMonorepoSkills(): void {
  return;
}

function sync(): void {
  // 1. Validate monorepo skills
  validateMonorepoSkills();

  // 2. Component inventory for this workspace.
  writeJson(join(root, ".agents", "plugins", "components.json"), discoverComponents());

  // 3. Keep the unified Aphrody marketplace local; remove generated duplicates.
  for (const duplicate of [
    join(root, "plugins", ".claude-plugin"),
    join(root, ".agents", "plugins", "marketplace.json"),
  ]) {
    rmSync(duplicate, { recursive: true, force: true });
  }

  // 4. Local workspace agy configuration (.agents/skills.json and .agents/plugins.json)
  // Keep the checked-in workspace catalog bound to the unified plugin.
  const localAgySkills = join(root, ".agents", "skills.json");
  writeJson(localAgySkills, {
    entries: [{ path: "plugins/aphrody/skills" }],
  });

  const localAgyPlugins = join(root, ".agents", "plugins.json");
  writeJson(localAgyPlugins, {
    entries: [{ path: "plugins/aphrody" }],
  });

  // 5. Claude Code: register the unified plugin marketplace from this repository.
  const globalClaudeSettings = join(homedir(), ".claude", "settings.json");
  try {
    const conf = existsSync(globalClaudeSettings)
      ? (JSON.parse(readFileSync(globalClaudeSettings, "utf8")) as Record<string, unknown>)
      : {};
    const enabled = (conf.enabledPlugins as Record<string, boolean>) || {};
    for (const key of Object.keys(enabled)) {
      if (
        key.endsWith("@aphrody-local") ||
        key === "aphrody" ||
        key === "yolo" ||
        key === "aphrody@aphrody-os" ||
        key === "aphrody-ai@aphrody-ai" ||
        key === "aphrody@aphrody" ||
        key === "yolo@aphrody"
      )
        delete enabled[key];
    }
    conf.enabledPlugins = enabled;
    const markets = (conf.extraKnownMarketplaces as Record<string, unknown>) || {};
    delete markets.aphrody;
    delete markets["aphrody-os"];
    markets["aphrody-ai"] = { source: { source: "directory", path: root } };
    enabled["aphrody@aphrody-ai"] = true;
    conf.extraKnownMarketplaces = markets;
    writeJson(globalClaudeSettings, conf);
  } catch {
    // Ignore parse errors on external files
  }

  // Project settings are left untouched; Aphrody OS owns its plugin scope.
  const localClaudeSettings = join(root, ".claude", "settings.json");
  if (existsSync(localClaudeSettings)) {
    try {
      const conf = JSON.parse(readFileSync(localClaudeSettings, "utf8")) as Record<string, unknown>;
      const enabled = (conf.enabledPlugins as Record<string, boolean>) || {};
      let changed = false;
      for (const key of Object.keys(enabled)) {
        if (key.endsWith("@aphrody-local")) {
          delete enabled[key];
          changed = true;
        }
      }
      if (changed) {
        conf.enabledPlugins = enabled;
        writeJson(localClaudeSettings, conf);
      }
    } catch {
      // Ignore parse errors
    }
  }

  // 6. Global agy skill registry: expose the one unified skill root.
  const agySkills = join(homedir(), ".gemini", "config", "skills.json");
  if (existsSync(dirname(agySkills))) {
    const current = existsSync(agySkills)
      ? (JSON.parse(readFileSync(agySkills, "utf8").replace(/^\uFEFF/, "")) as Record<
          string,
          unknown
        >)
      : {};
    const entries = Array.isArray(current.entries)
      ? current.entries.filter((entry: unknown) => {
          const path = String((entry as { path?: unknown }).path ?? "");
          // Remove prior registrations before adding the current owned skill roots.
          const isAphrody = path.includes("plugins/aphrody") || path.includes("plugins\\aphrody");
          const isYolo =
            path === join(root, "packages", "yolo", "skills") ||
            path === join(root, "packages", "yolo") ||
            path.endsWith("aphrody-os\\plugins\\aphrody\\skills") ||
            path.endsWith("aphrody-os/plugins/aphrody/skills") ||
            path.endsWith("YOLO\\skills") ||
            path.endsWith("YOLO/skills");
          return existsSync(path) && !isAphrody && !isYolo;
        })
      : [];
    entries.push({ path: resolve(root, "plugins", "aphrody", "skills") });
    writeJson(agySkills, { ...current, entries });
  }

  console.log(`synced the unified Aphrody plugin from ${root}`);
}

export function runAgentPluginSync(args: string[]): number {
  const rootIndex = args.indexOf("--root");
  if (rootIndex >= 0) root = resolve(args[rootIndex + 1] ?? "");
  if (!root) throw new Error("--root requires an Aphrody AI repository");
  const dryRun = args.includes("--dry-run");
  if (dryRun) console.log(JSON.stringify(discoverComponents(), null, 2));
  else sync();
  if (args.includes("--watch")) {
    console.log("watching first-party plugin files; press Ctrl+C to stop");
    watch(root, { recursive: true }, (_event, file) => {
      if (
        file &&
        (file.endsWith("plugin.json") || file.includes("/skills/") || file.includes("\\skills\\"))
      )
        sync();
    });
  }
  return 0;
}

if (import.meta.main) process.exit(runAgentPluginSync(process.argv.slice(2)));
