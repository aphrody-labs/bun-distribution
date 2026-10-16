// SPDX-License-Identifier: Apache-2.0
// Renders tools/config/local-ai.env.example from tools/config/local-ai.json.
//
//   bun scripts/tools/infra/gen-local-ai-env.ts          write the file
//   bun scripts/tools/infra/gen-local-ai-env.ts --check  exit 1 when the file drifted
//
// The example never carries values: URLs are resolved per target (static on
// vps, `aphrody ai env` on developer hosts) and secrets live in operator env
// files. Per-target values and defaults are written as comments.
import { join, resolve } from "node:path";

type Env = {
  canonical: string;
  kind: string;
  form?: string;
  aliases?: string[];
  aliasForms?: Record<string, string>;
};
type Endpoint = {
  protocol: string;
  service?: string;
  binary?: string;
  basePath?: string;
  baseUrlFrom?: string;
  operations?: string[];
  command?: string;
  tool?: string;
  auth?: string;
  local?: boolean;
  defaultModel?: string | null;
  dimensions?: number;
  env?: Env[];
  note?: string;
};
type Binary = {
  sourceRepo: string;
  package: string;
  buildFeatures?: string[];
  env: Env[];
};
type Binding = {
  service: string;
  index?: string;
  env?: Record<string, string>;
  secretsFrom?: string;
};
type Target = {
  resolution: "static" | "runtime";
  resolver?: string;
  services?: string[];
  bindings?: Record<string, Binding>;
  unavailable?: Record<string, string>;
};
type Index = {
  servedModel: string;
  dimensions: number;
  service: string;
  rule: string;
};
export type Contract = {
  schemaVersion: number;
  name: string;
  binaries?: Record<string, Binary>;
  gateways?: Record<string, Endpoint>;
  capabilities: Record<string, Endpoint>;
  indexes?: Record<string, Index>;
  targets: Record<string, Target>;
};

const root = resolve(import.meta.dir, "..", "..", "..");
export const contractPath = join(root, "tools", "config", "local-ai.json");
export const examplePath = join(
  root,
  "tools",
  "config",
  "local-ai.env.example",
);

function aliasLine(env: Env): string | undefined {
  const aliases = env.aliases ?? [];
  if (aliases.length === 0) return undefined;
  const described = aliases.map((alias) => {
    const form = env.aliasForms?.[alias];
    return form ? `${alias} (${form} form)` : alias;
  });
  return `# Legacy aliases, read in this order: ${described.join(", ")}.`;
}

function kindLine(env: Env): string {
  return env.form
    ? `# ${env.canonical}: ${env.kind}, ${env.form} form.`
    : `# ${env.canonical}: ${env.kind}.`;
}

/** Comments giving the value of `name` on each target that defines it. */
function targetLines(
  contract: Contract,
  owner: string,
  endpoint: Endpoint,
  env: Env,
): string[] {
  const lines: string[] = [];
  for (const [id, target] of Object.entries(contract.targets)) {
    if (target.resolution === "runtime") {
      // A runtime target resolves process capabilities and the services it runs.
      if (!endpoint.service || target.services?.includes(endpoint.service)) {
        lines.push(`# ${id}: printed by \`${target.resolver}\`.`);
      } else {
        lines.push(
          `# ${id}: not provided (${endpoint.service} does not run there).`,
        );
      }
      continue;
    }
    const binding = target.bindings?.[owner];
    const value = binding?.env?.[env.canonical];
    if (value !== undefined) lines.push(`# ${id}: ${value}`);
    else if (binding && env.kind === "secret" && binding.secretsFrom)
      lines.push(`# ${id}: operator file ${binding.secretsFrom}`);
    else if (binding) lines.push(`# ${id}: not set by the contract.`);
    else if (target.unavailable?.[owner])
      lines.push(`# ${id}: unavailable, ${target.unavailable[owner]}.`);
  }
  return lines;
}

function defaultLine(
  endpoint: Endpoint | undefined,
  env: Env,
): string | undefined {
  if (!endpoint) return undefined;
  if (env.kind === "model" && endpoint.defaultModel)
    return `# Default model: ${endpoint.defaultModel}.`;
  if (env.kind === "dimensions" && endpoint.dimensions)
    return `# Default dimensions: ${endpoint.dimensions}.`;
  return undefined;
}

function endpointHeader(
  kind: string,
  id: string,
  endpoint: Endpoint,
): string[] {
  const parts = [endpoint.protocol];
  if (endpoint.service) parts.push(`service ${endpoint.service}`);
  if (endpoint.binary) parts.push(`binary ${endpoint.binary}`);
  if (endpoint.basePath) parts.push(`basePath ${endpoint.basePath}`);
  if (endpoint.auth) parts.push(`auth ${endpoint.auth}`);
  if (endpoint.command) parts.push(`command \`${endpoint.command}\``);
  if (endpoint.tool) parts.push(`tool ${endpoint.tool}`);
  const lines = [`## ${kind} ${id}: ${parts.join(", ")}`];
  if (endpoint.operations?.length)
    lines.push(`# Operations: ${endpoint.operations.join(" ")}`);
  if (endpoint.baseUrlFrom)
    lines.push(`# Base URL: shared with ${endpoint.baseUrlFrom}.`);
  if (endpoint.local === false) lines.push("# Not served locally.");
  if (endpoint.note) lines.push(`# ${endpoint.note}`);
  return lines;
}

function envBlock(
  contract: Contract,
  owner: string,
  endpoint: Endpoint | undefined,
  env: Env,
): string[] {
  const lines = [kindLine(env)];
  const alias = aliasLine(env);
  if (alias) lines.push(alias);
  const fallback = defaultLine(endpoint, env);
  if (fallback) lines.push(fallback);
  if (endpoint) lines.push(...targetLines(contract, owner, endpoint, env));
  lines.push(`${env.canonical}=`);
  return lines;
}

export function render(contract: Contract): string {
  const out: string[] = [
    "# Generated by scripts/tools/infra/gen-local-ai-env.ts from tools/config/local-ai.json. Do not edit by hand:",
    "# change the contract, then run `bun scripts/tools/infra/gen-local-ai-env.ts`.",
    `# Contract ${contract.name}, schemaVersion ${contract.schemaVersion}.`,
    "#",
    "# Values stay empty on purpose. Each target fills them as commented below;",
    "# consumers read the canonical name first, then each legacy alias in order.",
    "# Secrets come from operator-managed env files, never from Git.",
  ];
  for (const [id, index] of Object.entries(contract.indexes ?? {})) {
    out.push(
      "#",
      `# Index ${id}: ${index.servedModel}, ${index.dimensions} dimensions, served by ${index.service} (${index.rule}).`,
      "# Querying it with another embedding model or dimension is forbidden.",
    );
  }
  for (const [id, binary] of Object.entries(contract.binaries ?? {})) {
    const features = binary.buildFeatures?.length
      ? `, features ${binary.buildFeatures.join(",")}`
      : "";
    out.push(
      "",
      `## Binary ${id}: package ${binary.package} (${binary.sourceRepo}${features})`,
    );
    for (const env of binary.env)
      out.push(...envBlock(contract, id, undefined, env));
  }
  for (const [kind, group] of [
    ["Gateway", contract.gateways ?? {}],
    ["Capability", contract.capabilities],
  ] as const) {
    for (const [id, endpoint] of Object.entries(group)) {
      out.push("", ...endpointHeader(kind, id, endpoint));
      const envs = endpoint.env ?? [];
      if (envs.length === 0) out.push("# No canonical env name.");
      for (const env of envs)
        out.push(...envBlock(contract, id, endpoint, env));
    }
  }
  return `${out.join("\n")}\n`;
}

export async function loadContract(path = contractPath): Promise<Contract> {
  return JSON.parse(await Bun.file(path).text()) as Contract;
}

if (import.meta.main) {
  const expected = render(await loadContract());
  if (Bun.argv.includes("--check")) {
    const file = Bun.file(examplePath);
    const current = (await file.exists())
      ? (await file.text()).replaceAll("\r\n", "\n")
      : "";
    if (current !== expected) {
      console.error(
        "tools/config/local-ai.env.example drifted from tools/config/local-ai.json: run `bun scripts/tools/infra/gen-local-ai-env.ts`.",
      );
      process.exit(1);
    }
    console.log("local-ai-env: ok");
  } else {
    await Bun.write(examplePath, expected);
    console.log(`wrote ${examplePath}`);
  }
}
