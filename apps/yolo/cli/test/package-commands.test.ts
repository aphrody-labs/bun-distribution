import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  PACKAGE_COMMANDS,
  isPackageCommand,
  packageRoot,
  runPackageCommand,
} from "../src/package-commands";

const root = resolve(import.meta.dir, "../../../..");
const entry = join(root, "apps/yolo/cli/src/index.ts");
const fixture = mkdtempSync(join(tmpdir(), "yolo-package-commands-"));

afterAll(() => rmSync(fixture, { recursive: true, force: true }));

function owner(name: keyof typeof PACKAGE_COMMANDS, source: string): string {
  const fixtureRoot = join(fixture, name);
  const path = join(fixtureRoot, PACKAGE_COMMANDS[name].module);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source);
  return fixtureRoot;
}

function yolo(...args: string[]) {
  const result = Bun.spawnSync([process.execPath, entry, ...args], {
    cwd: root,
    env: { ...process.env, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30_000,
  });
  return {
    status: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe("yolo package commands", () => {
  it("source runs use this checkout as the owner root", () => {
    expect(packageRoot()).toBe(root);
    expect(isPackageCommand("ops")).toBe(true);
    expect(isPackageCommand("toString")).toBe(false);
  });

  it("every command names an owner module that exports its runner", async () => {
    for (const [name, { module, run }] of Object.entries(PACKAGE_COMMANDS)) {
      const path = join(root, module);
      expect(existsSync(path), `${name}: ${module}`).toBe(true);
      const loaded = (await import(path)) as Record<string, unknown>;
      expect(typeof loaded[run], `${name}: ${module} exports ${run}`).toBe("function");
    }
  });

  it("dispatches in-process with the literal arguments and returns the runner status", async () => {
    const fixtureRoot = owner(
      "update",
      "export function runUpdate(argv) { globalThis.yoloPackageArgs = argv; return 23; }\n",
    );
    const args = ["rust", "status", "--root", "/srv/repo", "$(literal)"];
    expect(await runPackageCommand("update", args, fixtureRoot)).toBe(23);
    expect((globalThis as { yoloPackageArgs?: unknown }).yoloPackageArgs).toEqual(args);
  });

  it("maps owner failures to exit statuses", async () => {
    const throwing = owner("doc-ai", "export async function main() { throw new Error('boom'); }\n");
    expect(await runPackageCommand("doc-ai", [], throwing)).toBe(1);
    const noExport = owner("google", "export const unrelated = 1;\n");
    expect(await runPackageCommand("google", [], noExport)).toBe(70);
    expect(await runPackageCommand("browser", [], join(fixture, "empty"))).toBe(127);
    expect(await runPackageCommand("unknown", [], root)).toBe(2);
  });

  it("the CLI entry routes each command to its owner", () => {
    const cases: [string[], string][] = [
      [
        ["optimize", "--print", "--", "deduplicate selected imports"],
        "deduplicate selected imports",
      ],
      [["workspace", "--help"], "code-edit <operation>"],
      [["ops", "iecode-doctor", "--help"], "Usage: yolo ops iecode-doctor"],
      [["update", "help"], "yolo update check"],
      [["google", "--help"], "yolo google <drive|fonts>"],
      [["doc-ai", "--help"], "yolo doc-ai translate"],
      [["browser", "--version"], "@aphrody/agent-browser"],
    ];
    for (const [args, expected] of cases) {
      const result = yolo(...args);
      expect(result.status, `${args.join(" ")}: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain(expected);
    }
  });

  it("the CLI entry keeps owner exit statuses and leaves Rust-owned commands to aphrody", () => {
    const google = yolo("google", "models");
    expect(google.status).toBe(2);
    expect(google.stderr).toContain("aphrody google models");
    expect(isPackageCommand("ovh")).toBe(false);
    expect(yolo("browser", "mcp").status).toBe(2);
    expect(yolo("update", "no-such-module").status).toBe(2);
  });
});
