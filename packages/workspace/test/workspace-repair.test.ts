// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runHostPaths } from "../src/host-paths.ts";
import { scanImportsExports } from "../src/imports-exports.ts";
import {
  runWorkspaceRepair,
  type WorkspaceRepairOwners,
} from "../src/workspace-repair.ts";

function owners(
  overrides: Partial<WorkspaceRepairOwners> = {},
): WorkspaceRepairOwners {
  return {
    hostPaths: async () => 0,
    imports: async () => {},
    documentation: async () => 0,
    links: async () => 0,
    powershell: async () => 0,
    ...overrides,
  };
}

test("context repair previews, then applies only clean tracked references and inventories real AST imports", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspace-repair-"));
  const home = ["", "home", "fixture"].join("/");
  const original = `Open ${home}/aphrody/README.md\n`;
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", "-C", root, ...args], {
      windowsHide: true,
    });
    expect(result.exitCode).toBe(0);
  };
  const logs: unknown[] = [];
  const log = console.log;
  try {
    await mkdir(join(root, "docs"));
    await mkdir(join(root, "packages/example/src"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ workspaces: ["packages/*"] }),
    );
    await writeFile(
      join(root, "packages/example/package.json"),
      JSON.stringify({ name: "fixture", exports: "./src/index.ts" }),
    );
    await writeFile(
      join(root, "packages/example/src/index.ts"),
      'export { missing } from "./missing.ts";\n',
    );
    await writeFile(join(root, "docs/clean.md"), original);
    await writeFile(join(root, "docs/dirty.md"), original);
    git("init", "-q");
    git("add", ".");
    git(
      "-c",
      "user.name=fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--no-verify",
      "-qm",
      "fixture",
    );
    const dirty = `${original}concurrent change\n`;
    await writeFile(join(root, "docs/dirty.md"), dirty);
    console.log = (...args: unknown[]) => {
      logs.push(...args);
    };
    let importRuns = 0;
    let documentationRuns = 0;
    let linkRuns = 0;
    const selected = owners({
      hostPaths: runHostPaths,
      imports: async (args, selectedRoot) => {
        expect(args).toEqual(["--workspace", "fixture"]);
        const summary = await scanImportsExports(
          selectedRoot ?? process.cwd(),
          "fixture",
        );
        expect(summary.packageCount).toBe(1);
        expect(summary.packages[0]?.imports[0]?.resolution).toBe("unresolved");
        expect(summary.packages[0]?.imports[0]?.specifier).toBe("./missing.ts");
        importRuns++;
      },
      documentation: async (args) => {
        expect(args).toEqual(["check", "--root", resolve(root)]);
        documentationRuns++;
        return 0;
      },
      links: async (args) => {
        expect(args).toEqual([
          "--root",
          resolve(root),
          "--scope",
          "repository",
        ]);
        linkRuns++;
        return 0;
      },
    });
    const args = ["--root", root, "--workspace", "fixture"];
    expect(await runWorkspaceRepair(args, selected)).toBe(0);
    expect(await readFile(join(root, "docs/clean.md"), "utf8")).toBe(original);
    expect(await readFile(join(root, "docs/dirty.md"), "utf8")).toBe(dirty);
    expect(await runWorkspaceRepair([...args, "--apply"], selected)).toBe(0);
    expect(await readFile(join(root, "docs/clean.md"), "utf8")).toBe(
      "Open README.md\n",
    );
    expect(await readFile(join(root, "docs/dirty.md"), "utf8")).toBe(dirty);
    const report = JSON.parse(logs[1] as string);
    expect(report.skippedDirty).toEqual(["docs/dirty.md"]);
    expect([importRuns, documentationRuns, linkRuns]).toEqual([2, 2, 2]);
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
  }
});

test("all read-only gates finish and failures propagate after owner-safe mutations", async () => {
  const calls: string[] = [];
  const error = console.error;
  console.error = () => {};
  try {
    const result = await runWorkspaceRepair(
      ["--powershell"],
      owners({
        hostPaths: async () => {
          calls.push("paths");
          return 0;
        },
        imports: async () => {
          calls.push("imports");
          throw new Error("AST inventory failed");
        },
        documentation: async () => {
          calls.push("docs");
          return 2;
        },
        links: async () => {
          calls.push("links");
          return 0;
        },
        powershell: async () => {
          calls.push("powershell");
          return 0;
        },
      }),
    );
    expect(result).toBe(1);
    expect(calls).toEqual(["paths", "imports", "docs", "links", "powershell"]);
  } finally {
    console.error = error;
  }
});

test("retired two-checkout and dirty override arguments fail before touching an owner", async () => {
  let called = false;
  const selected = owners({
    hostPaths: async () => {
      called = true;
      return 0;
    },
  });
  await Promise.all(
    [
      ["--ai-root", "old"],
      ["--include-dirty"],
      ["--root"],
      ["--workspace", "--apply"],
    ].map((args) =>
      expect(runWorkspaceRepair(args, selected)).rejects.toThrow(),
    ),
  );
  expect(called).toBe(false);
});
