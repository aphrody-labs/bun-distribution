// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { applyAction, parsePluginArgs, pluginOperation, publicPlan } from "../src/agent-plugins.ts";
import { checkPluginFacts, refreshPluginFacts } from "../src/plugin-facts.ts";
import {
  cleanStore,
  fixReferences,
  prepareStore,
  readJson,
  skillFrontmatter,
  storeLock,
  validateStore,
} from "../src/agent-plugin-store.ts";
import {
  installationPlan,
  providerConfig,
  replaceTomlTable,
  scopeFor,
  template,
} from "../src/agent-plugin-providers.ts";

const roots: string[] = [];
function fixture(): { root: string; home: string; store: string; cwd: string } {
  const root = mkdtempSync(join(tmpdir(), "aphrody-plugin-test-"));
  roots.push(root);
  const home = join(root, "home"),
    store = join(home, "plugins"),
    cwd = join(home, "aphrody");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(store, { recursive: true });
  return { root, home, store, cwd };
}
function file(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
function plugin(store: string, name = "example"): string {
  const path = join(store, name);
  file(
    join(path, "plugin.json"),
    JSON.stringify({ name, version: "2.0.0", description: "Example plugin" }),
  );
  file(
    join(path, "skills/demo/SKILL.md"),
    "---\nname: demo\ndescription: Use this skill to inspect a fixture.\n---\n# Example\n",
  );
  return path;
}
const configPath = join(import.meta.dir, "../../../tools/aphrody/config/ai/agent-plugin-providers.json");
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("prepare synchronizes portable/provider versions without registering a provider", () => {
  const f = fixture(),
    p = plugin(f.store);
  file(
    join(p, ".claude-plugin/plugin.json"),
    JSON.stringify({
      name: "example",
      version: "1.0.0",
      license: "Apache-2.0",
      icon: "icon.webp",
      userConfig: {
        endpoint: { type: "string", title: "Endpoint", description: "Private local endpoint" },
      },
    }),
  );
  file(
    join(p, ".mcp.json"),
    JSON.stringify({ mcpServers: { example: { command: "fixture", args: [] } } }),
  );
  expect(prepareStore(f.store, "owner-local", false).length).toBeGreaterThan(0);
  expect(existsSync(join(f.store, ".agents"))).toBe(false);
  prepareStore(f.store, "owner-local", true);
  expect(readJson(join(p, ".claude-plugin/plugin.json")).version).toBe("2.0.0");
  expect(readJson(join(p, ".claude-plugin/plugin.json")).license).toBe("Apache-2.0");
  expect(readJson(join(p, ".claude-plugin/plugin.json")).userConfig).toBeDefined();
  expect(readJson(join(p, ".codex-plugin/plugin.json")).version).toBe("2.0.0");
  expect(validateStore(f.store)).toEqual([]);
  expect(existsSync(join(f.home, ".codex"))).toBe(false);
  expect(prepareStore(f.store, "owner-local", true)).toEqual([]);
});
test("reference repair fixes exact old paths and colon descriptions and is idempotent", () => {
  const f = fixture(),
    p = plugin(f.store, "aphrody"),
    old = join(f.cwd, "plugins/aphrody");
  file(
    join(f.store, "relocation-2026-10-03.json"),
    JSON.stringify({ moves: [{ kind: "canonical-plugin", source: old, destination: p }] }),
  );
  file(
    join(p, "agents/profile.md"),
    `---\nname: profile\ndescription: Measure performance: use a reproducible benchmark.\n---\nRead ${old}/skills/demo/SKILL.md and ~/.gemini/plugins/aphrody/skills/demo/SKILL.md. Preserve ${old}-other.\n`,
  );
  fixReferences(f.store, true);
  expect(skillFrontmatter(join(p, "agents/profile.md")).description).toBe(
    "Measure performance: use a reproducible benchmark.",
  );
  expect(readFileSync(join(p, "agents/profile.md"), "utf8")).toContain(p);
  expect(readFileSync(join(p, "agents/profile.md"), "utf8")).not.toContain("~/.gemini/plugins");
  expect(readFileSync(join(p, "agents/profile.md"), "utf8")).toContain(`${old}-other`);
  expect(fixReferences(f.store, true)).toEqual([]);
});
test("cleanup preserves unique source bytes and deletes only detached cache directories", () => {
  const f = fixture(),
    p = plugin(f.store);
  file(
    join(f.store, "_copies/old/plugins/example/plugin.json"),
    readFileSync(join(p, "plugin.json"), "utf8"),
  );
  file(
    join(f.store, "_copies/old/plugins/example/unique.txt"),
    "Unique historical customization\n",
  );
  file(join(f.store, "unrelated.txt"), "keep me");
  const plan = cleanStore(f.store, false);
  expect(plan.recovered).toBe(1);
  expect(existsSync(join(f.store, "_copies"))).toBe(true);
  cleanStore(f.store, true);
  expect(readFileSync(join(f.store, "_recovered/old/plugins/example/unique.txt"), "utf8")).toBe(
    "Unique historical customization\n",
  );
  expect(existsSync(join(f.store, "_copies"))).toBe(false);
  expect(existsSync(join(f.store, "unrelated.txt"))).toBe(true);
  expect(cleanStore(f.store, true).bytes).toBe(0);
});
test("component validation refuses path traversal and escaping symlinks", () => {
  const f = fixture(),
    p = plugin(f.store);
  file(join(f.root, "outside.md"), "private");
  file(
    join(p, ".codex-plugin/plugin.json"),
    JSON.stringify({ name: "example", version: "2.0.0", skills: "./../../outside.md" }),
  );
  expect(validateStore(f.store).some((problem) => problem.message.includes("escapes"))).toBe(true);
  symlinkSync(f.root, join(p, "outside"), "dir");
  file(
    join(p, ".codex-plugin/plugin.json"),
    JSON.stringify({ name: "example", version: "2.0.0", skills: "./outside" }),
  );
  expect(validateStore(f.store).some((problem) => problem.message.includes("Symlink"))).toBe(true);
});
test("cleanup refuses a symlink that could erase external data", () => {
  const f = fixture();
  file(join(f.root, "private/keep.txt"), "keep");
  symlinkSync(join(f.root, "private"), join(f.store, "_copies"), "dir");
  expect(() => cleanStore(f.store, true)).toThrow("linked cleanup directory");
  expect(existsSync(join(f.root, "private/keep.txt"))).toBe(true);
});
test("restricted plugins and their standalone skills retain project activation", () => {
  const f = fixture(),
    p = plugin(f.store, "aphrody"),
    config = providerConfig(configPath),
    codex = config.providers.find((provider) => provider.id === "codex")!;
  expect(() => scopeFor(config, "aphrody", f.cwd, f.home, "user")).toThrow("restricted");
  expect(() => scopeFor(config, "iecode", f.cwd, f.home)).toThrow("not allowed");
  const plan = installationPlan(config, codex, f.store, f.home, f.cwd, "plugin", "aphrody");
  expect(plan.scope).toBe("project");
  expect(plan.actions.some((a) => a.type === "toml-plugin" && !a.enabled)).toBe(true);
  const skill = installationPlan(
    config,
    codex,
    f.store,
    f.home,
    f.cwd,
    "skill",
    "demo",
    join(p, "skills/demo"),
  );
  expect(skill.scope).toBe("project");
  expect(skill.actions[0]).toMatchObject({
    type: "skill-link",
    path: join(f.cwd, ".agents/skills/demo"),
  });
});
test("standalone skill links are idempotent and never overwrite another skill", () => {
  const f = fixture(),
    p = plugin(f.store),
    source = join(p, "skills/demo"),
    path = join(f.home, ".agents/skills/demo");
  const action = { type: "skill-link" as const, path, source };
  expect(applyAction(action, f.cwd, f.home).status).toBe("installed");
  expect(applyAction(action, f.cwd, f.home).status).toBe("already-installed");
  applyAction({ ...action, remove: true }, f.cwd, f.home);
  expect(existsSync(path)).toBe(false);
  file(join(path, "SKILL.md"), "unrelated skill");
  expect(() => applyAction(action, f.cwd, f.home)).toThrow("another source");
  expect(readFileSync(join(path, "SKILL.md"), "utf8")).toBe("unrelated skill");
});
test("TOML reconciliation preserves unrelated private values and handles unquoted old tables", () => {
  const text =
    '# private config\nmodel = "keep"\n[mcp_servers.fixture]\ncommand = "old"\n[mcp_servers.fixture.env]\nOLD = "stale"\n[mcp_servers.other]\ncommand = "other"\n';
  const result = replaceTomlTable(text, 'mcp_servers."fixture"', {
    command: "new",
    args: ["mcp"],
    env: { TOKEN: "${PRIVATE_TOKEN}" },
  });
  const parsed = Bun.TOML.parse(result) as { model: string; mcp_servers: Record<string, unknown> };
  expect(parsed.model).toBe("keep");
  expect(parsed.mcp_servers.other).toEqual({ command: "other" });
  expect(parsed.mcp_servers.fixture).toEqual({
    command: "new",
    args: ["mcp"],
    env: { TOKEN: "${PRIVATE_TOKEN}" },
  });
  expect(result).toContain("# private config");
  expect(() => replaceTomlTable("invalid = [", 'mcp_servers."x"', {})).toThrow();
});
test("MCP planning preserves transport/options without exposing secrets", () => {
  const f = fixture(),
    config = providerConfig(configPath),
    codex = config.providers.find((p) => p.id === "codex")!;
  const source = join(f.root, "server.json");
  file(
    source,
    JSON.stringify({
      type: "http",
      url: "https://example.invalid/mcp",
      headers: { Authorization: "private-fixture-token" },
    }),
  );
  const plan = installationPlan(config, codex, f.store, f.home, f.cwd, "mcp", "fixture", source);
  expect(JSON.stringify(publicPlan(plan))).not.toContain("private-fixture-token");
  for (const action of plan.actions) applyAction(action, f.cwd, f.home);
  const text = readFileSync(join(f.home, ".codex/config.toml"), "utf8");
  expect(text).toContain("private-fixture-token");
  expect((Bun.TOML.parse(text) as Json).mcp_servers).toBeDefined();
});
test("argv templates preserve spaces literally and reject missing values", () => {
  expect(
    template(["plugin", "install", "{path}", "{args}"], {
      path: "/tmp/a b",
      args: ["literal $(test)", "--value"],
    }),
  ).toEqual(["plugin", "install", "/tmp/a b", "literal $(test)", "--value"]);
  expect(() => template(["{missing}"], {})).toThrow("Missing");
});
test("dry installation never writes provider state or executes mutation commands", async () => {
  const f = fixture();
  plugin(f.store, "yolo");
  prepareStore(f.store, "aphrody-user", true);
  const args = parsePluginArgs([
    "install",
    "--name",
    "yolo",
    "--provider",
    "claude",
    "--home",
    f.home,
    "--store",
    f.store,
    "--cwd",
    f.cwd,
  ]);
  let calls = 0;
  const result = await pluginOperation(args, () => {
    calls++;
    throw new Error("unexpected execution");
  });
  expect(calls).toBe(0);
  expect(result.apply).toBe(false);
  expect(existsSync(join(f.home, ".claude"))).toBe(false);
});
test("store mutations use one cooperative lock and release it after failure", async () => {
  const f = fixture();
  await expect(
    storeLock(f.store, true, async () => {
      await storeLock(f.store, true, async () => 0);
    }),
  ).rejects.toThrow("locked");
  expect(existsSync(join(f.store, "_state/mutation.lock"))).toBe(false);
});
type Json = Record<string, unknown>;

test("cleanup records exact aliases and never overwrites a historical recovery", () => {
  const f = fixture(),
    p = plugin(f.store);
  file(
    join(f.store, "_copies/old/plugins/example/plugin.json"),
    readFileSync(join(p, "plugin.json"), "utf8"),
  );
  file(join(f.store, "_copies/old/plugins/example/unique.txt"), "new historical variant");
  file(join(f.store, "_recovered/old/plugins/example/unique.txt"), "older retained variant");
  const report = cleanStore(f.store, true);
  expect(report.aliases[0]?.canonical).toBe(join(p, "plugin.json"));
  expect(readFileSync(join(f.store, "_recovered/old/plugins/example/unique.txt"), "utf8")).toBe(
    "older retained variant",
  );
  expect(
    report.changes.some(
      (c) => c.action === "recover" && readFileSync(c.path, "utf8") === "new historical variant",
    ),
  ).toBe(true);
});
test("preparation refuses an overlay whose ancestor links outside the store", () => {
  const f = fixture(),
    p = plugin(f.store);
  mkdirSync(join(f.root, "private"));
  symlinkSync(join(f.root, "private"), join(p, ".claude-plugin"), "dir");
  expect(() => prepareStore(f.store, "owner-local", true)).toThrow("Symlink escapes");
  expect(existsSync(join(f.root, "private/plugin.json"))).toBe(false);
});
test("Codex project removal preserves the shared package and nested policy", () => {
  const f = fixture(),
    config = providerConfig(configPath),
    codex = config.providers.find((p) => p.id === "codex")!;
  plugin(f.store, "aphrody");
  const plan = installationPlan(
    config,
    codex,
    f.store,
    f.home,
    f.cwd,
    "plugin",
    "aphrody",
    undefined,
    "project",
    true,
  );
  expect(plan.actions.some((a) => a.type === "command")).toBe(false);
  const text =
    '[plugins."aphrody@aphrody-user"]\nenabled = true\nother = "keep"\n[plugins."aphrody@aphrody-user".mcp_servers.aphrody]\nenabled = false\n';
  const parsed = Bun.TOML.parse(
    replaceTomlTable(text, 'plugins."aphrody@aphrody-user"', { enabled: false }),
  ) as Json;
  expect((parsed.plugins as Json)["aphrody@aphrody-user"]).toEqual({
    enabled: false,
    other: "keep",
    mcp_servers: { aphrody: { enabled: false } },
  });
});
test("project agy MCP uses a registered plugin and removes only owned files", () => {
  const f = fixture(),
    config = providerConfig(configPath),
    agy = config.providers.find((p) => p.id === "agy")!;
  const source = join(f.root, "mcp.json");
  file(
    source,
    JSON.stringify({
      command: "aphrody",
      args: ["kernel", "mcp"],
      env: { PRIVATE: "fixture-value" },
    }),
  );
  const install = installationPlan(
    config,
    agy,
    f.store,
    f.home,
    f.cwd,
    "mcp",
    "fixture",
    source,
    "project",
  );
  expect(JSON.stringify(publicPlan(install))).not.toContain("fixture-value");
  for (const action of install.actions) applyAction(action, f.cwd, f.home);
  expect(readJson(join(f.cwd, ".agents/plugins.json")).entries).toEqual([
    { path: join(f.cwd, ".agents/aphrody-mcp"), include_only: ["fixture"] },
  ]);
  const root = join(f.cwd, ".agents/aphrody-mcp/fixture");
  file(join(root, "keep.txt"), "unrelated");
  const remove = installationPlan(
    config,
    agy,
    f.store,
    f.home,
    f.cwd,
    "mcp",
    "fixture",
    source,
    "project",
    true,
  );
  for (const action of remove.actions) applyAction(action, f.cwd, f.home);
  expect(existsSync(join(root, "mcp_config.json"))).toBe(false);
  expect(readFileSync(join(root, "keep.txt"), "utf8")).toBe("unrelated");
});
test("declarative adapters support another scoped CLI without changing code", () => {
  const f = fixture(),
    config = providerConfig(configPath);
  plugin(f.store);
  const provider = {
    ...config.providers[1]!,
    id: "custom",
    binary: "custom-cli",
    pluginInstall: [["plugins", "install", "--scope", "{scope}", "{path}"]],
    skillsDirectory: "{home}/.custom/skills",
    projectSkillsDirectory: "{cwd}/.custom/skills",
  };
  const plan = installationPlan(
    { ...config, providers: [provider] },
    provider,
    f.store,
    f.home,
    f.cwd,
    "plugin",
    "example",
    undefined,
    "project",
  );
  expect(plan.actions[0]).toEqual({
    type: "command",
    command: ["custom-cli", "plugins", "install", "--scope", "project", join(f.store, "example")],
  });
});
test("native validation failure prevents every installation command", async () => {
  const f = fixture();
  plugin(f.store);
  prepareStore(f.store, "aphrody-user", true);
  const config = providerConfig(configPath),
    provider = {
      ...config.providers[1]!,
      id: "fixture",
      binary: process.execPath,
      pluginValidation: ["validate", "{path}"],
      pluginInstall: [["mutate", "{path}"]],
    };
  const path = join(f.root, "providers.json");
  file(path, JSON.stringify({ ...config, providers: [provider] }));
  const args = parsePluginArgs([
    "install",
    "--name",
    "example",
    "--provider",
    "fixture",
    "--store",
    f.store,
    "--home",
    f.home,
    "--cwd",
    f.cwd,
    "--config",
    path,
    "--apply",
  ]);
  const called: string[][] = [];
  await expect(
    pluginOperation(args, (command) => {
      called.push(command);
      return { command, exitCode: 1, output: "invalid fixture" };
    }),
  ).rejects.toThrow("Native validation failed");
  expect(called.some((cmd) => cmd.includes("mutate"))).toBe(false);
});

test("plugin facts receipts identify source and knowledge drift", () => {
  const f = fixture();
  const root = join(f.root, "source");
  file(join(root, "docs.md"), "Verified provider contract v1\n");
  const p = plugin(f.store);
  file(join(p, "skills", "demo", "SKILL.md"), "Evidence-aligned workflow\n");
  file(
    join(p, "source-of-truth.json"),
    JSON.stringify({
      version: 1,
      sources: [{ root, evidence: ["docs.md"] }],
      knowledge: ["skills/demo/SKILL.md"],
    }),
  );
  expect(checkPluginFacts(f.store)[0]?.status).toBe("stale");
  refreshPluginFacts(f.store, undefined, true);
  expect(checkPluginFacts(f.store)[0]?.status).toBe("current");
  file(join(root, "docs.md"), "Verified provider contract v2\n");
  expect(checkPluginFacts(f.store)[0]?.status).toBe("stale");
});
