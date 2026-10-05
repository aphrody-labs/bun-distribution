// SPDX-License-Identifier: Apache-2.0
import { join, resolve } from "node:path";
import { runScriptAudit } from "./audit-scripts.ts";
import { runRustBridge } from "./bridges.ts";
import { runConsolidation } from "./consolidation.ts";
import { buildDependencies, dependencyBuildPlan } from "./bun-dependency-builds.ts";
import { routeHeavyBuild } from "./build-factory.ts";
import { infraRoot } from "./runtime.ts";

const WORKSPACE_ROOTS = ["apps/shenron", "packages/shenron"] as const;
const CHECKS = ["format", "lint", "typecheck", "test", "build"] as const;
type Check = (typeof CHECKS)[number];
type Workspace = {
  name: string;
  path: string;
  kind: "app" | "package";
  scripts: Record<string, string>;
};

export function shenronRoots(root = infraRoot()): string[] {
  return WORKSPACE_ROOTS.map((path) => join(root, path));
}

async function workspaces(root = infraRoot()): Promise<Workspace[]> {
  const found: Workspace[] = [];
  for (const [index, directory] of shenronRoots(root).entries()) {
    for await (const manifestPath of new Bun.Glob("*/package.json").scan({
      cwd: directory,
      absolute: true,
    })) {
      const manifest = (await Bun.file(manifestPath).json()) as {
        name?: string;
        scripts?: Record<string, string>;
      };
      found.push({
        name: manifest.name ?? manifestPath,
        path: manifestPath.slice(0, -"/package.json".length),
        kind: index === 0 ? "app" : "package",
        scripts: manifest.scripts ?? {},
      });
    }
  }
  return found.toSorted((left, right) => left.name.localeCompare(right.name));
}

function checkScripts(check: Check): string[] {
  const scripts: Record<Check, string[]> = {
    format: ["format:check"],
    lint: ["lint"],
    typecheck: ["type-check", "typecheck"],
    test: ["test"],
    build: ["build"],
  };
  return scripts[check];
}

async function selectedWorkspaces(
  items: Workspace[],
  selector: string | undefined,
): Promise<Workspace[]> {
  if (!selector) return items;
  const selected = items.filter(
    (item) => item.name === selector || item.name.endsWith(`/${selector}`),
  );
  if (!selected.length) throw new Error(`unknown Shenron workspace: ${selector}`);
  return selected;
}

async function runCheck(args: string[], root: string): Promise<number> {
  const [name, ...options] = args;
  if (!CHECKS.includes(name as Check))
    throw new Error(`usage: aphrody-ops shenron check <${CHECKS.join("|")}> [--workspace <name>]`);
  let selector: string | undefined;
  for (let index = 0; index < options.length; index++) {
    if (options[index] !== "--workspace" || selector || !options[index + 1])
      throw new Error(
        `usage: aphrody-ops shenron check <${CHECKS.join("|")}> [--workspace <name>]`,
      );
    selector = options[++index];
  }
  const selected = await selectedWorkspaces(await workspaces(root), selector);
  const needsArtifacts =
    name === "typecheck" &&
    (
      await dependencyBuildPlan(
        root,
        selected.map((workspace) => workspace.name),
      )
    ).length > 0;
  if (name === "test" || name === "build" || needsArtifacts) {
    const dispatched = await routeHeavyBuild(
      ["bun", "packages/infra/workspace/src/ops.ts", "shenron", "check", ...args],
      root,
    );
    if (dispatched !== undefined) return dispatched;
  }
  if (["typecheck", "test", "build"].includes(name!)) {
    const code = await buildDependencies(
      root,
      selected.map((workspace) => workspace.name),
    );
    if (code !== 0) return code;
  }
  let exitCode = 0;
  for (const workspace of selected) {
    const script =
      name === "build" && workspace.scripts["build:owner"]
        ? "build:owner"
        : checkScripts(name as Check).find((candidate) => workspace.scripts[candidate]);
    if (!script) continue;
    console.error(`Shenron ${name}: ${workspace.name} (${script})`);
    const child = Bun.spawn([process.execPath, "run", script], {
      cwd: workspace.path,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const result = await child.exited;
    if (result !== 0) exitCode = result;
  }
  return exitCode;
}

async function runDeclaredScript(args: string[], root: string): Promise<number> {
  const [selector, script, ...scriptArgs] = args;
  if (!selector || !script)
    throw new Error(
      "usage: aphrody-ops shenron script <workspace> <declared-script> [arguments...]",
    );
  const selected = await selectedWorkspaces(await workspaces(root), selector);
  if (selected.length !== 1) throw new Error("select exactly one Shenron workspace");
  const workspace = selected[0]!;
  if (!Object.hasOwn(workspace.scripts, script))
    throw new Error(`${workspace.name} does not declare script ${script}`);
  const ownerScript =
    ["build", "compile"].includes(script) && workspace.scripts[`${script}:owner`]
      ? `${script}:owner`
      : script;
  if (/^(?:build|compile|test|typecheck|type-check)(?::owner)?$/.test(ownerScript)) {
    const dispatched = await routeHeavyBuild(
      [
        "bun",
        "packages/infra/workspace/src/ops.ts",
        "shenron",
        "script",
        workspace.name,
        ownerScript,
        ...scriptArgs,
      ],
      root,
    );
    if (dispatched !== undefined) return dispatched;
    const code = await buildDependencies(root, [workspace.name]);
    if (code !== 0) return code;
  }
  const child = Bun.spawn([process.execPath, "run", ownerScript, ...scriptArgs], {
    cwd: workspace.path,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return child.exited;
}

async function migrate(args: string[], root: string): Promise<number> {
  const [operation = "inventory", ...extra] = args;
  const actions: Record<string, string> = {
    inventory: "inventory",
    scripts: "scripts-import",
    docs: "docs-import",
  };
  if (operation === "infra") {
    if (extra.length) throw new Error("usage: aphrody-ops shenron migrate infra");
    const common = ["--source-root", resolve(root, "."), "--aphrody-root", root];
    return runConsolidation(["infra-scripts-import", ...common]);
  }
  const action = actions[operation];
  if (!action || extra.length)
    throw new Error("usage: aphrody-ops shenron migrate <inventory|scripts|docs|infra>");
  return runConsolidation([
    action,
    "--source-root",
    resolve(root, "."),
    "--aphrody-root",
    root,
    ...(operation === "inventory" ? [] : ["--owner", "shenron"]),
  ]);
}

/** Shenron quality, migration and operations facade over its workspaces and Aphrody Infra. */
export async function runShenron(args: string[], root = infraRoot()): Promise<number> {
  const [action = "status", ...rest] = args;
  if (action === "status" || action === "scripts") {
    const items = await workspaces(root);
    console.log(
      JSON.stringify(
        action === "status"
          ? {
              module: "shenron",
              roots: shenronRoots(root),
              workspaces: items.map(({ name, path, kind, scripts }) => ({
                name,
                path,
                kind,
                scripts: Object.keys(scripts).toSorted(),
              })),
            }
          : items.map(({ name, kind, scripts }) => ({
              name,
              kind,
              scripts: Object.entries(scripts).toSorted(([left], [right]) => left.localeCompare(right)),
            })),
        null,
        2,
      ),
    );
    return 0;
  }
  if (action === "check") return runCheck(rest, root);
  if (CHECKS.includes(action as Check)) return runCheck([action, ...rest], root);
  if (action === "script") return runDeclaredScript(rest, root);
  if (action === "audit") {
    if (rest.length) throw new Error("usage: aphrody-ops shenron audit");
    await runScriptAudit("shenron", root);
    return 0;
  }
  if (action === "migrate") return migrate(rest, root);
  if (action === "infra") {
    if (!rest.length)
      throw new Error("usage: aphrody-ops shenron infra <aphrody-infra arguments...>");
    return runRustBridge("aphrody-infra", rest, { stdout: "inherit", stderr: "inherit" });
  }
  if (action === "service")
    return runRustBridge("aphrody-infra", ["service", ...rest], {
      stdout: "inherit",
      stderr: "inherit",
    });
  if (action === "deploy") {
    const targetIndex = rest.indexOf("--target");
    if (
      targetIndex < 0 ||
      !rest[targetIndex + 1] ||
      !rest.includes("--release") ||
      !rest[rest.indexOf("--release") + 1] ||
      rest.includes("--stack") ||
      rest.filter((argument) => argument === "--target").length !== 1
    )
      throw new Error(
        "usage: aphrody-ops shenron deploy --target <infra-target> --release <path> [--apply]",
      );
    return runRustBridge("aphrody-infra", ["deploy", "--stack", "shenron", ...rest], {
      stdout: "inherit",
      stderr: "inherit",
    });
  }
  if (action === "dev-env")
    return runRustBridge("aphrody-infra", ["dev-env", ...rest], {
      stdout: "inherit",
      stderr: "inherit",
    });
  throw new Error(
    "usage: aphrody-ops shenron <status|scripts|check|script|audit|migrate|infra|service|deploy|dev-env> ...",
  );
}
