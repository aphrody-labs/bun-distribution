// SPDX-License-Identifier: Apache-2.0
import { resolve } from "node:path";
import { runDocumentation } from "./documentation.ts";
import { runDocsLinks } from "./docs-links.ts";
import { runHostPaths } from "./host-paths.ts";
import { runImportsExports } from "./imports-exports.ts";
import { runPowerShellSyntax } from "./powershell-syntax.ts";

const USAGE =
  "Usage: yolo ops workspace-repair [--root <repository>] [--workspace <name-or-path>] [--apply] [--powershell]\nPreview is read-only. --apply repairs clean tracked host-path references only; imports and generated documentation are checked by their existing owners.";

/** Owner injection permits isolated integration tests without mutating a shared checkout. */
export interface WorkspaceRepairOwners {
  hostPaths: typeof runHostPaths;
  imports: typeof runImportsExports;
  documentation: typeof runDocumentation;
  links: typeof runDocsLinks;
  powershell: typeof runPowerShellSyntax;
}

const OWNERS: WorkspaceRepairOwners = {
  hostPaths: runHostPaths,
  imports: runImportsExports,
  documentation: runDocumentation,
  links: runDocsLinks,
  powershell: runPowerShellSyntax,
};

export async function runWorkspaceRepair(args: string[], owners: WorkspaceRepairOwners = OWNERS): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return 0;
  }
  let root = process.cwd();
  let workspace: string | undefined;
  let apply = false;
  let powershell = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--root" || arg === "--workspace") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      if (arg === "--root") root = value;
      else workspace = value;
    } else if (arg === "--apply") apply = true;
    else if (arg === "--powershell") powershell = true;
    else throw new Error(`Unknown argument: ${arg}\n${USAGE}`);
  }
  root = resolve(root);
  // Mutations finish before checks; the host-path owner preserves concurrent dirty files.
  const paths = await owners.hostPaths(["--root", root, ...(apply ? ["--apply"] : [])]);
  const results = await Promise.allSettled([
    owners.imports(workspace ? ["--workspace", workspace] : [], root),
    owners.documentation(["check", "--root", root]),
    owners.links(["--root", root, "--scope", "repository"]),
    ...(powershell ? [owners.powershell(["--root", root])] : []),
  ]);
  let code = paths;
  for (const result of results) {
    if (result.status === "rejected") {
      console.error(result.reason instanceof Error ? result.reason.message : result.reason);
      code ||= 1;
    } else if (typeof result.value === "number") code ||= result.value;
  }
  return code;
}
