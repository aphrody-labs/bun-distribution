// SPDX-License-Identifier: Apache-2.0
/** Derive validation stages from the active manifests, bottom to top. */
import { join } from "node:path";
import { firstPartyManifests } from "./bun-workspace.ts";
const DOMAIN_ORDER = [
  "bun",
  "compat",
  "os",
  "interop",
  "infra",
  "ui",
  "web",
  "ai",
  "discord",
  "koharu",
  "fut",
  "rg",
  "shenron",
];
export async function pipelineCatalog(root: string) {
  const stages: {
    id: string;
    parallel: boolean;
    steps: { repo: string; runner?: string; command: string[] }[];
  }[] = [
    {
      id: "structure",
      parallel: false,
      steps: [{ repo: "aphrody", command: ["run", "monorepo:layout"] }],
    },
    {
      id: "rust-foundation",
      parallel: false,
      steps: ["check", "clippy", "test"].map((gate) => ({
        repo: "aphrody",
        runner: "just",
        command: [gate],
      })),
    },
  ];
  const groups = new Map<string, { repo: string; command: string[] }[]>();
  const absent: { path: string; missing: string[] }[] = [];
  for (const path of await firstPartyManifests(root)) {
    const pkg = await Bun.file(join(root, path)).json();
    const domain = path.split("/")[1] ?? "other";
    const scripts: Record<string, string> = pkg.scripts ?? {};
    const selected = [["lint"], ["typecheck", "type-check"], ["test"], ["build"]].map(
      (alternatives) => alternatives.find((name) => scripts[name]),
    );
    absent.push({
      path,
      missing: ["lint", "typecheck", "test", "build"].filter((_, i) => !selected[i]),
    });
    const steps = groups.get(domain) ?? [];
    for (const name of selected)
      if (name) steps.push({ repo: "aphrody", command: ["run", "--filter", pkg.name, name] });
    groups.set(domain, steps);
  }
  for (const domain of [
    ...DOMAIN_ORDER,
    ...[...groups.keys()].filter((d) => !DOMAIN_ORDER.includes(d)).toSorted(),
  ]) {
    const steps = groups.get(domain);
    if (steps?.length)
      stages.push({
        id: domain === "shenron" ? "product-shenron-final" : `bun-${domain}`,
        parallel: false,
        steps,
      });
  }
  return {
    config: {
      schemaVersion: 1,
      name: "aphrody-monorepo-validation",
      authority: "@aphrody/workspace",
      workspaceRoot: "..",
      stages,
    },
    missingGates: absent.filter((p) => p.missing.length),
  };
}
export async function runPipelineCatalog(args: string[]): Promise<number> {
  let root = process.cwd();
  let apply = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") root = args[++i] ?? "";
    else if (args[i] === "--apply") apply = true;
    else if (args[i] === "--help") {
      console.log("Usage: aphrody-ops pipeline-catalog [--root path] [--apply]");
      return 0;
    } else throw new Error(`Unknown argument: ${args[i]}`);
  }
  const report = await pipelineCatalog(root);
  if (apply)
    await Bun.write(
      join(root, "config/pipeline.json"),
      JSON.stringify(report.config, null, 2) + "\n",
    );
  console.log(
    JSON.stringify(
      {
        stages: report.config.stages.length,
        steps: report.config.stages.reduce((n, s) => n + s.steps.length, 0),
        missingGates: report.missingGates,
      },
      null,
      2,
    ),
  );
  return 0;
}
if (import.meta.main) process.exit(await runPipelineCatalog(process.argv.slice(2)));
