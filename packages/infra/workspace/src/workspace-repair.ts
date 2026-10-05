import { resolve } from "node:path";
import { runDocsLinks } from "./docs-links.ts";
import { runPowerShellSyntax } from "./powershell-syntax.ts";
import { runWorkspaceDeps } from "./workspace-deps.ts";

function value(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function run(root: string, command: string[], label: string): Promise<void> {
  const child = Bun.spawn(command, { cwd: root, stdout: "inherit", stderr: "inherit" });
  if ((await child.exited) !== 0) throw new Error(`${label} failed`);
}

export async function runWorkspaceRepair(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Usage: yolo ops workspace-repair --ai-root <repo> --os-root <repo> --repo <aphrody|aphrody-os> [--apply] [--include-dirty]",
    );
    return 0;
  }
  const ai = value(args, "--ai-root");
  const os = value(args, "--os-root");
  const selected = value(args, "--repo");
  const apply = args.includes("--apply");
  const includeDirty = args.includes("--include-dirty");
  if (!ai || !os || !selected || !["aphrody", "aphrody-os"].includes(selected))
    throw new Error(
      "Usage: yolo ops workspace-repair --ai-root <repo> --os-root <repo> --repo <aphrody|aphrody-os> [--apply] [--include-dirty]",
    );
  const roots = { aphrody: resolve(ai), "aphrody-os": resolve(os) };
  const target = roots[selected as keyof typeof roots];
  const refScript = resolve(roots["aphrody-os"], "scripts/fix-refs.nu");
  const refArgs = [
    "nu",
    refScript,
    "links",
    "--aphrody",
    roots.aphrody,
    "--os",
    roots["aphrody-os"],
    "--repo",
    selected,
  ];
  if (apply) refArgs.push("--apply");
  if (includeDirty) refArgs.push("--include-dirty");
  await run(target, refArgs, "reference link repair");
  const refsArgs = [...refArgs];
  refsArgs[2] = "refs";
  await run(target, refsArgs, "reference repair");
  const dependencyArgs = [
    "--root",
    target,
    "--sibling",
    selected === "aphrody" ? roots["aphrody-os"] : roots.aphrody,
  ];
  if (apply) dependencyArgs.push("--apply");
  await runWorkspaceDeps(dependencyArgs);
  await runPowerShellSyntax(["--root", target]);
  return runDocsLinks(["--root", target, "--scope", "repository"]);
}
