#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Writes src/generated/inventory.json: every package and app of the monorepo (name, version, description, entry
// points, location, whether it is in the Bun workspace). The showcase serves it from its own API (`/api/packages`)
// and its pages read the same data. A test checks the committed file is current: run `bun run inventory` after a
// version or description change.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const here = dirname(import.meta.path);
export const ROOT = resolve(here, "../../..");
export const OUT = join(here, "../src/generated/inventory.json");

export interface InventoryEntry {
  name: string;
  version: string;
  description: string;
  /** Path relative to the repository. */
  dir: string;
  kind: "package" | "app";
  /** In the Bun workspace (installed and linked) or a host-bound member outside it. */
  workspace: boolean;
  private: boolean;
  /** Number of `exports` entries (0 when the package declares `main` only). */
  exports: number;
  bin: string[];
}

function workspaceExclusions(root: string): Set<string> {
  const manifest = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  ) as {
    workspaces?: { packages?: string[] };
  };
  return new Set(
    (manifest.workspaces?.packages ?? [])
      .filter((g) => g.startsWith("!"))
      .map((g) => g.slice(1)),
  );
}

/** The inventory, sorted by name. */
export function collect(root: string = ROOT): InventoryEntry[] {
  const excluded = workspaceExclusions(root);
  const entries: InventoryEntry[] = [];
  for (const [kind, base] of [
    ["package", "packages"],
    ["app", "apps"],
  ] as const) {
    const dir = join(root, base);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).toSorted()) {
      const file = join(dir, name, "package.json");
      if (!existsSync(file)) continue;
      const manifest = JSON.parse(readFileSync(file, "utf8")) as {
        name: string;
        version?: string;
        description?: string;
        private?: boolean;
        exports?: Record<string, unknown> | string;
        bin?: string | Record<string, string>;
      };
      const rel = `${base}/${name}`;
      const exported = manifest.exports;
      entries.push({
        name: manifest.name,
        version: manifest.version ?? "0.0.0",
        description: (manifest.description ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 220),
        dir: rel,
        kind,
        workspace: !excluded.has(rel),
        private: manifest.private === true,
        exports:
          typeof exported === "object" && exported
            ? Object.keys(exported).length
            : exported
              ? 1
              : 0,
        bin:
          typeof manifest.bin === "string"
            ? [manifest.name]
            : Object.keys(manifest.bin ?? {}),
      });
    }
  }
  return entries.toSorted((a, b) => a.name.localeCompare(b.name));
}

if (import.meta.main) {
  const entries = collect();
  await Bun.write(OUT, `${JSON.stringify(entries, null, 2)}\n`);
  console.log(`inventory: ${entries.length} packages and apps -> ${OUT}`);
}
