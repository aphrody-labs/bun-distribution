// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from "@aphrody/update/process";
import { userHome } from "@aphrody/paths";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  inside,
  object,
  plugins,
  readJson,
  validName,
  type Json,
} from "./agent-plugin-store.ts";

export type Provider = {
  id: string;
  binary: string;
  versionArgs: string[];
  pluginHelp: string[];
  pluginValidation: string[] | null;
  pluginInstall: string[][];
  pluginRemove: string[];
  skillsDirectory: string;
  projectSkillsDirectory?: string;
  mcpAdd: string[];
  mcpRemove: string[];
  docs: string;
};
export type ProviderConfig = {
  version: number;
  marketplace: string;
  providers: Provider[];
  scopes: Record<string, string[]>;
};
export type CommandResult = {
  command: string[];
  exitCode: number;
  output: string;
};
export type Runner = (
  command: string[],
  cwd: string,
  home: string,
) => CommandResult;
export function redact(text: string): string {
  for (const [key, value] of Object.entries(process.env))
    if (
      value &&
      value.length >= 8 &&
      /token|secret|password|credential|api.?key/i.test(key)
    )
      text = text.replaceAll(value, "[redacted]");
  return text
    .replace(/(Bearer\s+)[^\s"']+/gi, "$1[redacted]")
    .replace(
      /([\w-]*(?:token|secret|password|api[_-]?key)[\w-]*\s*[=:]\s*["']?)[^\s"',}]+/gi,
      "$1[redacted]",
    )
    .slice(0, 10000);
}
export const runCommand: Runner = (command, cwd, home) => {
  const [binary, ...args] = command;
  if (!binary) throw new Error("Empty command");
  const result = spawnSync(binary, args, {
    cwd,
    timeout: 30000,
    maxBuffer: 1024 * 1024,
    env: {
      ...process.env,
      ...(resolve(home) === resolve(userHome())
        ? {}
        : {
            HOME: home,
            USERPROFILE: home,
            CODEX_HOME: join(home, ".codex"),
            CLAUDE_CONFIG_DIR: join(home, ".claude"),
          }),
    },
    encoding: "utf8",
  });
  return {
    command: command.map((arg) =>
      arg.startsWith("{") ? "[MCP configuration]" : redact(arg),
    ),
    exitCode: result.status ?? 1,
    output: redact(
      result.stdout + result.stderr + (result.error?.message ?? ""),
    ),
  };
};
export function providerConfig(path: string): ProviderConfig {
  const raw = readJson(path);
  if (raw.version !== 1 || !validName(String(raw.marketplace)))
    throw new Error("Unsupported provider config version or marketplace name");
  if (!Array.isArray(raw.providers))
    throw new Error("Provider list is required");
  const seen = new Set<string>();
  for (const value of raw.providers) {
    const p = object(value);
    if (
      !validName(String(p.id)) ||
      seen.has(String(p.id)) ||
      typeof p.binary !== "string" ||
      !p.binary
    )
      throw new Error("Invalid or duplicate provider");
    seen.add(String(p.id));
    for (const key of [
      "versionArgs",
      "pluginHelp",
      "pluginRemove",
      "mcpAdd",
      "mcpRemove",
    ])
      if (
        !Array.isArray(p[key]) ||
        !(p[key] as unknown[]).every((a) => typeof a === "string")
      )
        throw new Error(`Invalid ${key} for ${p.id}`);
    if (
      p.pluginValidation !== null &&
      (!Array.isArray(p.pluginValidation) ||
        !p.pluginValidation.every((a) => typeof a === "string"))
    )
      throw new Error(`Invalid validator for ${p.id}`);
    if (
      !Array.isArray(p.pluginInstall) ||
      !p.pluginInstall.every(
        (cmd) =>
          Array.isArray(cmd) && cmd.every((arg) => typeof arg === "string"),
      )
    )
      throw new Error(`Invalid install command for ${p.id}`);
    if (typeof p.skillsDirectory !== "string" || typeof p.docs !== "string")
      throw new Error(`Missing provider paths for ${p.id}`);
  }
  const scopes = object(raw.scopes ?? {});
  for (const [name, roots] of Object.entries(scopes))
    if (
      !validName(name) ||
      !Array.isArray(roots) ||
      !roots.length ||
      !roots.every((r) => typeof r === "string")
    )
      throw new Error(`Invalid scope for ${name}`);
  return raw as unknown as ProviderConfig;
}
export function template(
  args: string[],
  values: Record<string, string | string[]>,
): string[] {
  return args.flatMap((arg) => {
    const exact = arg.match(/^\{(\w+)\}$/);
    if (exact && Array.isArray(values[exact[1]!]))
      return values[exact[1]!] as string[];
    return [
      arg.replace(/\{(\w+)\}/g, (_, key: string) => {
        const value = values[key];
        if (typeof value !== "string")
          throw new Error(`Missing command template value: ${key}`);
        return value;
      }),
    ];
  });
}
export function scopeFor(
  config: ProviderConfig,
  name: string,
  cwd: string,
  home: string,
  requested?: string,
): "user" | "project" {
  const roots = config.scopes[name] ?? ["*"];
  if (requested && requested !== "user" && requested !== "project")
    throw new Error("Scope must be user or project");
  if (roots.includes("*")) {
    if (requested && requested !== "user" && requested !== "project")
      throw new Error("Scope must be user or project");
    return requested === "project" ? "project" : "user";
  }
  if (requested === "user")
    throw new Error(`Plugin ${name} is restricted to its declared workspaces`);
  if (
    !roots.some((root) => {
      const allowed = root.replaceAll("{home}", home);
      return (
        inside(allowed, cwd) &&
        (!existsSync(cwd) ||
          !existsSync(allowed) ||
          inside(realpathSync(allowed), realpathSync(cwd)))
      );
    })
  )
    throw new Error(`Plugin ${name} is not allowed in ${cwd}`);
  return "project";
}
export function detectProviders(
  config: ProviderConfig,
  cwd: string,
  home: string,
  runner: Runner = runCommand,
): Json[] {
  return config.providers.map((provider) => {
    const binary = Bun.which(provider.binary);
    if (!binary)
      return { id: provider.id, installed: false, docs: provider.docs };
    const help = runner([binary, ...provider.pluginHelp], cwd, home);
    const version = runner([binary, ...provider.versionArgs], cwd, home);
    return {
      id: provider.id,
      binary,
      installed: true,
      pluginCli: help.exitCode === 0,
      version:
        version.exitCode === 0
          ? version.output.trim().split("\n")[0]
          : "not advertised",
      nativePluginValidation: provider.pluginValidation !== null,
      docs: provider.docs,
    };
  });
}

/** The native validators remain authoritative; Codex's absent validator is reported explicitly. */
export function nativeValidation(
  config: ProviderConfig,
  store: string,
  home: string,
  cwd: string,
  selected: string[] = [],
  runner: Runner = runCommand,
  names: string[] = [],
): Json[] {
  const reports: Json[] = [];
  const entries = plugins(store).filter(
    (p) => !names.length || names.includes(p.name),
  );
  for (const provider of config.providers.filter(
    (p) => !selected.length || selected.includes(p.id),
  )) {
    if (!Bun.which(provider.binary)) {
      reports.push({ provider: provider.id, status: "unavailable" });
      continue;
    }
    if (!provider.pluginValidation) {
      reports.push({
        provider: provider.id,
        status: "no-native-validator",
        managerValidation:
          "JSON/YAML, component paths, versions, skills and local links",
      });
      continue;
    }
    for (const plugin of entries) {
      const values = {
        path: plugin.path,
        name: plugin.name,
        store,
        home,
        cwd,
        scope: "project",
        marketplace: config.marketplace,
      };
      const result = runner(
        [provider.binary, ...template(provider.pluginValidation, values)],
        cwd,
        home,
      );
      reports.push({
        provider: provider.id,
        plugin: plugin.name,
        status: result.exitCode === 0 ? "passed" : "failed",
        ...result,
      });
      if (provider.id === "claude") {
        for (const component of ["skills", "agents", "commands"]) {
          const path = join(plugin.path, component);
          if (!existsSync(path)) continue;
          const checked = runner(
            [
              provider.binary,
              ...template(provider.pluginValidation, { ...values, path }),
            ],
            cwd,
            home,
          );
          reports.push({
            provider: provider.id,
            plugin: plugin.name,
            component,
            status: checked.exitCode === 0 ? "passed" : "failed",
            ...checked,
          });
        }
      }
    }
    if (provider.id === "claude" && !names.length) {
      const result = runner(
        [
          provider.binary,
          "plugin",
          "validate",
          join(store, ".claude-plugin/marketplace.json"),
          "--strict",
          "--json",
        ],
        cwd,
        home,
      );
      reports.push({
        provider: provider.id,
        marketplace: config.marketplace,
        status: result.exitCode === 0 ? "passed" : "failed",
        ...result,
      });
    }
  }
  return reports;
}

export type InstallAction =
  | { type: "command"; command: string[] }
  | {
      type: "json-entry";
      path: string;
      field: string;
      key: string;
      value: unknown;
      remove?: boolean;
    }
  | {
      type: "toml-plugin";
      path: string;
      id: string;
      enabled: boolean;
      remove?: boolean;
    }
  | {
      type: "toml-mcp";
      path: string;
      name: string;
      server: Json;
      remove?: boolean;
    }
  | {
      type: "agy-project-mcp";
      path: string;
      name: string;
      server: Json;
      remove?: boolean;
    }
  | { type: "skill-link"; path: string; source: string; remove?: boolean };
export type InstallPlan = {
  provider: string;
  kind: string;
  name: string;
  scope: string;
  actions: InstallAction[];
};
export function installationPlan(
  config: ProviderConfig,
  provider: Provider,
  store: string,
  home: string,
  cwd: string,
  kind: string,
  name: string,
  source?: string,
  requestedScope?: string,
  remove = false,
): InstallPlan {
  if (!validName(name)) throw new Error("Invalid capability name");
  const scope = scopeFor(
    config,
    kind === "skill" ? name.split("--")[0]! : name,
    cwd,
    home,
    requestedScope,
  );
  const values: Record<string, string | string[]> = {
    name,
    store,
    home,
    cwd,
    scope,
    marketplace: config.marketplace,
    path: join(store, name),
  };
  const actions: InstallAction[] = [];
  if (kind === "plugin") {
    const plugin = plugins(store).find((p) => p.name === name);
    if (!plugin) throw new Error(`Plugin not found in central store: ${name}`);
    if (scope === "project" && provider.id === "agy") {
      // agy entries scan a directory one level deep; filter the store to this plugin.
      actions.push({
        type: "json-entry",
        path: join(cwd, ".agents/plugins.json"),
        field: "entries",
        key: plugin.path,
        value: { path: store, include_only: [name] },
        remove,
      });
    } else {
      if (
        scope === "project" &&
        !["codex", "claude"].includes(provider.id) &&
        !provider.pluginInstall.some((cmd) =>
          cmd.some((arg) => arg.includes("{scope}")),
        )
      )
        throw new Error(
          `Provider ${provider.id} needs an explicit project plugin adapter`,
        );
      if (!remove && scope === "project" && provider.id === "codex")
        actions.push({
          type: "toml-plugin",
          path: join(home, ".codex/config.toml"),
          id: `${name}@${config.marketplace}`,
          enabled: false,
        });
      const commands =
        remove && scope === "project" && provider.id === "codex"
          ? []
          : remove
            ? [provider.pluginRemove]
            : provider.pluginInstall;
      for (const cmd of commands)
        actions.push({
          type: "command",
          command: [provider.binary, ...template(cmd, values)],
        });
      if (scope === "project" && provider.id === "codex") {
        const id = `${name}@${config.marketplace}`;
        if (!remove)
          actions.push({
            type: "toml-plugin",
            path: join(home, ".codex/config.toml"),
            id,
            enabled: false,
          });
        actions.push({
          type: "toml-plugin",
          path: join(cwd, ".codex/config.toml"),
          id,
          enabled: true,
          remove,
        });
      }
    }
  } else if (kind === "skill") {
    if (!source)
      throw new Error("Standalone skill requires --source <skill-directory>");
    const dir = resolve(source),
      path = join(dir, "SKILL.md");
    if (!existsSync(path))
      throw new Error("Skill source must contain SKILL.md");
    const parts = relative(store, dir).split(/[\\/]/);
    const owner = parts[0];
    const effective =
      owner && inside(store, dir)
        ? scopeFor(config, owner, cwd, home, requestedScope)
        : scope;
    if (effective !== scope && requestedScope === "user")
      throw new Error("Restricted plugin skills cannot be installed globally");
    const skillRoot =
      effective === "project"
        ? (provider.projectSkillsDirectory?.replaceAll("{cwd}", cwd) ??
          join(
            cwd,
            provider.id === "claude" ? ".claude/skills" : ".agents/skills",
          ))
        : provider.skillsDirectory.replaceAll("{home}", home);
    actions.push({
      type: "skill-link",
      path: join(skillRoot, name),
      source: dir,
      remove,
    });
    return { provider: provider.id, kind, name, scope: effective, actions };
  } else if (kind === "mcp") {
    if (!source) throw new Error("MCP requires --source <JSON-file>");
    const raw = readJson(resolve(source));
    const server = object(raw.mcpServers ? object(raw.mcpServers)[name] : raw);
    if (typeof server.command !== "string" && typeof server.url !== "string")
      throw new Error("MCP needs a command or URL");
    // Preserve credentials and provider-specific transport options in private configuration files.
    if (provider.id === "codex") {
      const adapted = { ...server };
      delete adapted.type;
      if (server.headers) {
        adapted.http_headers = server.headers;
        delete adapted.headers;
      }
      actions.push({
        type: "toml-mcp",
        path: join(scope === "project" ? cwd : home, ".codex/config.toml"),
        name,
        server: adapted,
        remove,
      });
    } else if (provider.id === "agy") {
      if (scope === "project") {
        actions.push({
          type: "agy-project-mcp",
          path: join(cwd, ".agents/aphrody-mcp", name),
          name,
          server,
          remove,
        });
        actions.push({
          type: "json-entry",
          path: join(cwd, ".agents/plugins.json"),
          field: "entries",
          key: name,
          value: {
            path: join(cwd, ".agents/aphrody-mcp"),
            include_only: [name],
          },
          remove,
        });
      } else {
        actions.push({
          type: "json-entry",
          path: join(home, ".gemini/config/mcp_config.json"),
          field: "mcpServers",
          key: name,
          value: server,
          remove,
        });
      }
    } else {
      values.command = String(server.command ?? server.url);
      values.args = Array.isArray(server.args) ? server.args.map(String) : [];
      values.mcpJson = JSON.stringify(server);
      const cmd = remove ? provider.mcpRemove : provider.mcpAdd;
      if (
        !remove &&
        Object.keys(server).some(
          (k) => !["command", "args", "url", "type"].includes(k),
        ) &&
        !cmd.includes("{mcpJson}")
      )
        throw new Error(
          "Provider MCP adapter must preserve the complete JSON configuration",
        );
      if (!cmd.length)
        throw new Error(`Provider ${provider.id} has no MCP adapter`);
      actions.push({
        type: "command",
        command: [provider.binary, ...template(cmd, values)],
      });
    }
  } else throw new Error("Kind must be plugin, skill or mcp");
  return { provider: provider.id, kind, name, scope, actions };
}

/** Render one owned TOML table without replacing unrelated settings or comments. */
function tomlParts(s: string): string[] {
  return (s.match(/"(?:\\.|[^"\\])*"|'[^']*'|[a-zA-Z0-9_-]+/g) ?? []).map(
    (x) =>
      x.startsWith('"')
        ? (JSON.parse(x) as string)
        : x.startsWith("'")
          ? x.slice(1, -1)
          : x,
  );
}
export function replaceTomlTable(
  text: string,
  table: string,
  value: Json | null,
): string {
  const parsed = object(Bun.TOML.parse(text));
  void parsed; // Parse before editing; malformed private configuration must never be overwritten.
  const heading = `[${table}]`;
  const owned = tomlParts(table);
  if (owned[0] === "plugins" && value) {
    let current: unknown = parsed;
    for (const part of owned)
      current =
        current && typeof current === "object"
          ? (current as Json)[part]
          : undefined;
    if (current && typeof current === "object")
      value = { ...object(current), ...value };
  }
  const lines = text.split(/\r?\n/),
    kept: string[] = [];
  let dropping = false;
  for (const line of lines) {
    if (/^\s*\[/.test(line)) {
      const current = tomlParts(line.trim().split("]")[0]!);
      dropping =
        JSON.stringify(current) === JSON.stringify(owned) ||
        (["mcp_servers", "plugins"].includes(owned[0]!) &&
          current.length > owned.length &&
          owned.every((v, i) => current[i] === v));
    }
    if (!dropping) kept.push(line);
  }
  const body = kept.join("\n").trimEnd();
  if (value === null) return body ? `${body}\n` : "";
  const pairs = Object.entries(value).map(
    ([key, v]) => `${JSON.stringify(key)} = ${tomlValue(v)}`,
  );
  const result = `${body}${body ? "\n\n" : ""}${heading}\n${pairs.join("\n")}\n`;
  Bun.TOML.parse(result);
  return result;
}
function tomlValue(value: unknown): string {
  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  )
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(", ")}]`;
  const map = object(value);
  return `{ ${Object.entries(map)
    .map(([key, v]) => `${JSON.stringify(key)} = ${tomlValue(v)}`)
    .join(", ")} }`;
}
export function existingText(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}
