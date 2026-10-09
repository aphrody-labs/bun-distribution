// The unified plugin generator writes valid manifests, hooks, skills and agents.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateUnifiedYoloPlugin,
  type PluginHooksManifest,
  type PluginManifest,
} from "../src/cli/plugin/index";

test("the CLI dispatch creates a plugin through the absorbed command", () => {
  const target = join(root, "cli-plugin");
  const run = Bun.spawnSync(
    [process.execPath, join(import.meta.dir, "../src/index.ts"), "plugin", "create", target],
    {
      cwd: root,
      env: { ...process.env, APHRODY_YOLO_ROOT: join(root, "empty-yolo") },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  expect(run.exitCode).toBe(0);
  expect(run.stdout.toString()).toContain("Successfully generated");
  expect(Bun.file(join(target, "plugin.json")).size).toBeGreaterThan(0);
});

const root = mkdtempSync(join(tmpdir(), "yolo-plugins-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("generateUnifiedYoloPlugin", async () => {
  // A yolo root without vendor/bun: the generator indexes nothing and still writes a complete plugin.
  const result = await generateUnifiedYoloPlugin({
    targetDir: join(root, "plugin"),
    yoloRoot: join(root, "yolo"),
    name: "fixture",
    version: "2.0.0",
  });

  test("writes every manifest, hook, skill and agent", () => {
    expect([...result.filesGenerated].toSorted()).toEqual(
      [
        ".claude-plugin/plugin.json",
        ".codex-plugin/plugin.json",
        "README.md",
        "agents/explore.md",
        "agents/test-runner.md",
        "hooks.json",
        "hooks/hooks.json",
        "hooks/scripts/session-context.ts",
        "hooks/scripts/session-start.sh",
        "plugin.json",
        "skills/bun-doctrine/SKILL.md",
        "skills/typescript7-bun/SKILL.md",
        "skills/yolo/SKILL.md",
      ].toSorted(),
    );
  });

  test("the three plugin manifests are identical and carry the requested identity", async () => {
    const read = (f: string) =>
      Bun.file(join(result.pluginDir, f)).json() as Promise<PluginManifest>;
    const [plain, claude, codex] = await Promise.all([
      read("plugin.json"),
      read(".claude-plugin/plugin.json"),
      read(".codex-plugin/plugin.json"),
    ]);
    expect(plain).toMatchObject({ name: "fixture", version: "2.0.0", engines: { bun: ">=1.4.2" } });
    expect(claude).toEqual(plain);
    expect(codex).toEqual(plain);
  });

  test("hooks register the session-start script and skills carry front matter", async () => {
    const hooks = (await Bun.file(
      join(result.pluginDir, "hooks/hooks.json"),
    ).json()) as PluginHooksManifest;
    expect(hooks["fixture"]?.SessionStart?.[0]?.hooks[0]?.command).toContain(
      "hooks/scripts/session-start.sh",
    );
    for (const skill of ["yolo", "bun-doctrine", "typescript7-bun"]) {
      const text = await Bun.file(join(result.pluginDir, `skills/${skill}/SKILL.md`)).text();
      expect(text.startsWith(`---\nname: ${skill}\n`)).toBe(true);
    }
  });

  test("the generated session context runs under Bun and emits hook JSON", () => {
    const run = Bun.spawnSync(["bun", join(result.pluginDir, "hooks/scripts/session-context.ts")], {
      cwd: root,
      stdout: "pipe",
    });
    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout.toString()).hookSpecificOutput.hookEventName).toBe("SessionStart");
  });
});
