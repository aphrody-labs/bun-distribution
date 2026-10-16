// SPDX-License-Identifier: Apache-2.0
import { pluginStorePath, userHome } from "@aphrody/paths";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  rmSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  cleanStore,
  fixReferences,
  inside,
  object,
  plugins,
  prepareStore,
  readJson,
  skillFrontmatter,
  storeLock,
  validateStore,
  writeJson,
  type Change,
  type Json,
} from "./agent-plugin-store.ts";
import {
  detectProviders,
  existingText,
  installationPlan,
  nativeValidation,
  providerConfig,
  redact,
  replaceTomlTable,
  runCommand,
  type InstallAction,
  type InstallPlan,
  type Runner,
} from "./agent-plugin-providers.ts";
import { checkPluginFacts, refreshPluginFacts } from "./plugin-facts.ts";

const help = `Usage: yolo workspace plugins <command> [options]

Commands:
  status       Detect providers and inventory the canonical store
  fix-refs     Repair proven old plugin paths and invalid skill names
  clean        Remove detached caches/doubles, recovering unique source files
  prepare      Repair references, generate provider manifests/catalogs and format
  validate     Check all plugins/skills/MCP and run installed native validators
  facts        Check plugin knowledge against declared source code/docs receipts
  refresh-facts Refresh receipts after reviewing source changes (--apply)
  install      Install --kind plugin|skill|mcp --name NAME using provider adapters
  uninstall    Remove a registration using the same provider adapters

Options:
  --store PATH       APHRODY_PLUGINS_ROOT or ~/plugins by default
  --config PATH      Extensible provider adapter/scope registry
  --provider ID      Provider id, auto or all (default auto; repeatable)
  --kind KIND        plugin (default), skill or mcp
  --name NAME        Plugin, standalone skill or MCP server name
  --source PATH      Standalone skill directory or MCP JSON file
  --scope SCOPE      user or project (restricted plugins always project)
  --cwd PATH        Target repository (default current directory)
  --scan-root PATH   Operational directory for reference repair (repeatable)
  --home PATH       Provider home for isolated qualification
  --apply           Apply mutations; otherwise print a plan
  --json            Structured output

Add an adapter to --config for another CLI/provider. Missing native validation
is reported explicitly. Preparing does not install anything.
`;
type Args = {
  command: string;
  store: string;
  config: string;
  home: string;
  cwd: string;
  providers: string[];
  kind: string;
  name?: string;
  source?: string;
  scope?: string;
  scanRoots: string[];
  apply: boolean;
  json: boolean;
};
export function parsePluginArgs(argv: string[]): Args {
  const result: Args = {
    command: "status",
    store: pluginStorePath(),
    config: resolve(import.meta.dir, "../../../tools/aphrody/config/ai/agent-plugin-providers.json"),
    home: userHome(),
    cwd: process.cwd(),
    providers: [],
    kind: "plugin",
    scanRoots: [],
    apply: false,
    json: false,
  };
  let command = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      result.command = "help";
      continue;
    }
    if (arg === "--apply") {
      result.apply = true;
      continue;
    }
    if (arg === "--json") {
      result.json = true;
      continue;
    }
    if (arg === "--dry-run") {
      result.apply = false;
      continue;
    }
    if (!arg.startsWith("-") && !command) {
      result.command = arg;
      command = true;
      continue;
    }
    const value = argv[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    switch (arg) {
      case "--store":
      case "--root":
        result.store = resolve(value);
        break;
      case "--config":
        result.config = resolve(value);
        break;
      case "--cwd":
        result.cwd = resolve(value);
        break;
      case "--home":
        result.home = resolve(value);
        break;
      case "--provider":
        result.providers.push(value);
        break;
      case "--kind":
        result.kind = value;
        break;
      case "--name":
        result.name = value;
        break;
      case "--source":
        result.source = resolve(value);
        break;
      case "--scope":
        result.scope = value;
        break;
      case "--scan-root":
        result.scanRoots.push(resolve(value));
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (
    ![
      "help",
      "status",
      "fix-refs",
      "clean",
      "prepare",
      "validate",
      "facts",
      "refresh-facts",
      "install",
      "uninstall",
    ].includes(result.command)
  )
    throw new Error(`Unknown plugin operation: ${result.command}`);
  if (inside(result.store, result.home))
    throw new Error("Provider home cannot be inside the plugin store");
  return result;
}
function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, { mode: 0o600 });
}
export function applyAction(
  action: InstallAction,
  cwd: string,
  home: string,
  runner: Runner = runCommand,
): Json {
  if (action.type === "command") {
    if (basename(action.command[0] ?? "") === "codex")
      mkdirSync(join(home, ".codex"), { recursive: true });
    const result = runner(action.command, cwd, home);
    if (result.exitCode !== 0)
      throw new Error(`Provider command failed: ${result.command.join(" ")}\n${result.output}`);
    return { ...result };
  }
  if (action.type === "skill-link") {
    mkdirSync(dirname(action.path), { recursive: true });
    try {
      const info = lstatSync(action.path);
      if (
        !info.isSymbolicLink() ||
        resolve(dirname(action.path), readlinkSync(action.path)) !== resolve(action.source)
      )
        throw new Error(`Existing skill destination belongs to another source: ${action.path}`);
      if (action.remove) rmSync(action.path);
      return { path: action.path, status: action.remove ? "removed" : "already-installed" };
    } catch (e) {
      if (!(e && typeof e === "object" && "code" in e && e.code === "ENOENT")) throw e;
    }
    if (!action.remove)
      symlinkSync(action.source, action.path, process.platform === "win32" ? "junction" : "dir");
    return { path: action.path, status: action.remove ? "already-absent" : "installed" };
  }
  if (action.type === "agy-project-mcp") {
    const manifest = join(action.path, "plugin.json"),
      config = join(action.path, "mcp_config.json");
    if (existsSync(manifest) && readJson(manifest).managedBy !== "aphrody-workspace")
      throw new Error(`MCP plugin belongs to another source: ${action.path}`);
    if (action.remove) {
      if (existsSync(manifest)) {
        if (existsSync(config)) rmSync(config);
        rmSync(manifest);
      }
    } else {
      writeText(
        manifest,
        JSON.stringify(
          {
            name: action.name,
            version: "1.0.0",
            description: `Project MCP ${action.name}`,
            managedBy: "aphrody-workspace",
          },
          null,
          2,
        ) + "\n",
      );
      writeText(
        config,
        JSON.stringify({ mcpServers: { [action.name]: action.server } }, null, 2) + "\n",
      );
    }
    return { path: action.path, status: action.remove ? "removed" : "installed" };
  }
  if (action.type === "json-entry") {
    const value = existsSync(action.path) ? readJson(action.path) : {};
    if (action.field === "entries") {
      const entry = object(action.value),
        current = Array.isArray(value.entries) ? value.entries : [];
      const match = (v: unknown): boolean => {
        const other = object(v);
        return (
          other.path === entry.path &&
          JSON.stringify(other.include_only) === JSON.stringify(entry.include_only)
        );
      };
      value.entries = current.filter((v) => !match(v));
      if (!action.remove) (value.entries as unknown[]).push(entry);
    } else {
      const field = object(value[action.field] ?? {});
      if (action.remove) delete field[action.key];
      else field[action.key] = action.value;
      value[action.field] = field;
    }
    const changes: Change[] = [];
    const text = JSON.stringify(value, null, 2) + "\n";
    if (existingText(action.path) !== text) {
      writeText(action.path, text);
      changes.push({ path: action.path, action: "write" });
    }
    return { path: action.path, status: changes.length ? "updated" : "unchanged" };
  }
  const table =
    action.type === "toml-plugin"
      ? `plugins.${JSON.stringify(action.id)}`
      : `mcp_servers.${JSON.stringify(action.name)}`;
  const value = action.type === "toml-plugin" ? { enabled: action.enabled } : action.server;
  writeText(
    action.path,
    replaceTomlTable(existingText(action.path), table, action.remove ? null : value),
  );
  return { path: action.path, status: "updated" };
}
export function publicPlan(plan: InstallPlan): Json {
  return {
    ...plan,
    actions: plan.actions.map((action) => {
      if (action.type === "command")
        return {
          ...action,
          command: action.command.map((arg) =>
            arg.startsWith("{") ? "[MCP configuration]" : redact(arg),
          ),
        };
      if (action.type === "json-entry")
        return {
          ...action,
          value: action.field === "entries" ? action.value : "[MCP configuration]",
        };
      if (action.type === "toml-mcp" || action.type === "agy-project-mcp")
        return { ...action, server: "[MCP configuration]" };
      return action;
    }),
  };
}
export async function pluginOperation(args: Args, runner: Runner = runCommand): Promise<Json> {
  const config = providerConfig(args.config);
  const requested = args.providers.filter((id) => id !== "auto" && id !== "all");
  for (const id of requested)
    if (!config.providers.some((p) => p.id === id))
      throw new Error(`Provider adapter not configured: ${id}`);
  const selected = config.providers.filter((p) => !requested.length || requested.includes(p.id));
  return storeLock(args.store, args.apply, async () => {
    const base = { command: args.command, store: args.store, apply: args.apply };
    if (args.command === "status")
      return {
        ...base,
        providers: detectProviders(config, args.cwd, args.home, runner),
        plugins: plugins(args.store).map((p) => ({
          name: p.name,
          version: p.version,
          path: p.path,
          scopes: config.scopes[p.name] ?? ["*"],
        })),
      };
    if (args.command === "fix-refs")
      return { ...base, changes: fixReferences(args.store, args.apply, args.scanRoots) };
    if (args.command === "clean") return { ...base, ...cleanStore(args.store, args.apply) };
    if (args.command === "prepare") {
      const changes = [
        ...fixReferences(args.store, args.apply, args.scanRoots),
        ...prepareStore(args.store, config.marketplace, args.apply),
      ];
      let formatting: Json = { status: "planned" };
      if (args.apply) {
        const result = runner(
          [
            process.execPath,
            "fmt",
            "--write",
            ...plugins(args.store).map((p) => p.path),
            join(args.store, ".agents/plugins/marketplace.json"),
            join(args.store, ".claude-plugin/marketplace.json"),
          ],
          args.cwd,
          args.home,
        );
        formatting = { ...result, status: result.exitCode === 0 ? "passed" : "failed" };
        if (result.exitCode !== 0) throw new Error(`Plugin formatting failed: ${result.output}`);
      }
      return { ...base, changes, formatting };
    }
    if (args.command === "validate") {
      const problems = validateStore(args.store, args.name ? [args.name] : []);
      const native = nativeValidation(
        config,
        args.store,
        args.home,
        args.cwd,
        selected.map((p) => p.id),
        runner,
        args.name ? [args.name] : [],
      );
      return {
        ...base,
        problems,
        native,
        success: problems.length === 0 && !native.some((r) => r.status === "failed"),
      };
    }
    if (args.command === "facts" || args.command === "refresh-facts") {
      const facts =
        args.command === "refresh-facts"
          ? refreshPluginFacts(args.store, args.name, args.apply)
          : checkPluginFacts(args.store, args.name);
      return { ...base, facts, success: facts.every((item) => item.status === "current") };
    }
    if (!args.name) throw new Error("Installation and removal require --name");
    const remove = args.command === "uninstall",
      plans: InstallPlan[] = [];
    for (const provider of selected) {
      if (!requested.length && !Bun.which(provider.binary)) continue;
      plans.push(
        installationPlan(
          config,
          provider,
          args.store,
          args.home,
          args.cwd,
          args.kind,
          args.name,
          args.source,
          args.scope,
          remove,
        ),
      );
    }
    if (!plans.length) throw new Error("No configured provider CLI is installed");
    if (args.kind === "skill" && args.source) {
      const fm = skillFrontmatter(join(args.source, "SKILL.md"));
      if (fm.name !== args.name || typeof fm.description !== "string" || !fm.description.trim())
        throw new Error("Skill metadata does not match requested name");
    }
    const results: Json[] = [];
    if (args.apply) {
      if (!remove && args.kind === "plugin") {
        const problems = validateStore(args.store, [args.name]);
        if (problems.length)
          throw new Error(
            `Run prepare/validate before installing: ${problems.length} structural problems`,
          );
        const native = nativeValidation(
          config,
          args.store,
          args.home,
          args.cwd,
          selected.map((p) => p.id),
          runner,
          [args.name],
        );
        if (native.some((r) => r.status === "failed"))
          throw new Error("Native validation failed; no installation was started");
      }
      for (const plan of plans)
        for (const action of plan.actions)
          results.push(applyAction(action, args.cwd, args.home, runner));
      const state = join(args.store, "_state/installations.json"),
        current = existsSync(state) ? readJson(state) : {};
      for (const plan of plans) {
        const key = `${plan.provider}:${plan.kind}:${plan.name}:${plan.scope}:${plan.scope === "project" ? args.cwd : args.home}`;
        if (remove) delete current[key];
        else
          current[key] = {
            provider: plan.provider,
            kind: plan.kind,
            name: plan.name,
            scope: plan.scope,
            source: args.source ?? join(args.store, args.name),
            cwd: args.cwd,
          };
      }
      const changes: Change[] = [];
      writeJson(state, current, true, changes);
    }
    return { ...base, plans: plans.map(publicPlan), results };
  });
}
export async function runAgentPlugins(argv: string[]): Promise<number> {
  try {
    const args = parsePluginArgs(argv);
    if (args.command === "help") {
      console.log(help);
      return 0;
    }
    const report = await pluginOperation(args);
    if (args.apply) {
      const changes: Change[] = [];
      writeJson(join(args.store, "_state", `${args.command}-report.json`), report, true, changes);
    }
    console.log(JSON.stringify(report, null, 2));
    return report.success === false ? 1 : 0;
  } catch (e) {
    console.error(redact(e instanceof Error ? e.message : String(e)));
    return 1;
  }
}
if (import.meta.main) process.exit(await runAgentPlugins(process.argv.slice(2)));
