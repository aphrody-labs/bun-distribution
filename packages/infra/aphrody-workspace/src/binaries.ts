import { basename, join, resolve } from "node:path";
import { infraRoot } from "./runtime.ts";

export type AphrodyBinary = {
  name: string;
  path: string;
  source: "local-bin" | "release" | "debug";
  catalogued: boolean;
};

type Ecosystem = {
  cli?: Array<{ binary?: string }>;
  binariesWithoutClap?: Array<{ binary?: string }>;
};

function isAphrodyBinary(name: string): boolean {
  return name === "aphrody" || name === "n2b" || name.startsWith("aphrody-");
}

async function cataloguedNames(root: string): Promise<Set<string>> {
  const ecosystem = (await Bun.file(
    join(root, "docs", "ecosystem", "ecosystem.json"),
  ).json()) as Ecosystem;
  return new Set(
    [...(ecosystem.cli ?? []), ...(ecosystem.binariesWithoutClap ?? [])].flatMap((entry) =>
      entry.binary ? [entry.binary] : [],
    ),
  );
}

/** Discover only trusted local-bin and sibling-workspace build outputs, never arbitrary PATH files. */
export async function discoverAphrodyBinaries(root = infraRoot()): Promise<AphrodyBinary[]> {
  const catalogued = await cataloguedNames(root);
  const found = new Map<string, AphrodyBinary>();
  const add = async (path: string, source: AphrodyBinary["source"]): Promise<void> => {
    const name = basename(path);
    if (
      !isAphrodyBinary(name) ||
      name.includes(".") ||
      found.has(name) ||
      !(await Bun.file(path).exists())
    )
      return;
    found.set(name, { name, path, source, catalogued: catalogued.has(name) });
  };

  const home = process.env.HOME;
  if (home) {
    for (const name of new Set([...catalogued, "n2b"])) {
      await add(join(home, ".local", "bin", name), "local-bin");
    }
  }
  const workspace = resolve(root, "..");
  for (const profile of ["release", "debug"] as const) {
    for await (const path of new Bun.Glob(`*/target/${profile}/*`).scan({
      cwd: workspace,
      absolute: true,
    })) {
      await add(path, profile);
    }
  }
  return [...found.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export async function runAphrodyBinary(name: string, args: string[]): Promise<number> {
  if (!isAphrodyBinary(name)) throw new Error(`unsupported Aphrody binary name: ${name}`);
  const binary = (await discoverAphrodyBinaries()).find((entry) => entry.name === name);
  if (!binary) throw new Error(`Aphrody binary is not installed: ${name}`);
  const child = Bun.spawn([binary.path, ...args], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return child.exited;
}
