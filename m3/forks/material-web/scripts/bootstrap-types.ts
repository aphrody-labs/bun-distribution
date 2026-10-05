#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Separate the published declarations from colocated TypeScript sources so
// normal consumers never compile the fork's legacy decorator implementation.
// Installation needs only Bun and the versioned public declarations.
import { dirname, isAbsolute, relative, resolve } from "node:path";

export const SOURCE_ROOT = resolve(import.meta.dir, "..");

/** Recreate the public type tree from the package's existing published contract. */
export async function bootstrapTypes(packageRoot: string): Promise<number> {
  const root = resolve(packageRoot);
  const manifest = await Bun.file(resolve(root, "package.json")).json();
  if (manifest.name !== "@aphrody/material-web" || !Array.isArray(manifest.files)) {
    throw new Error("Expected the @aphrody/material-web public package manifest");
  }
  const declarations = manifest.files.filter(
    (file: unknown): file is string =>
      typeof file === "string" && file.endsWith(".d.ts") && !file.startsWith("types/"),
  );
  if (declarations.length === 0) throw new Error("No public declarations to bootstrap");
  await Promise.all(
    declarations.map(async (file: string) => {
      const sourcePath = resolve(root, file);
      const sourceRelative = relative(root, sourcePath);
      if (isAbsolute(file) || sourceRelative.startsWith("..") || isAbsolute(sourceRelative)) {
        throw new Error(`Declaration escapes the public package: ${file}`);
      }
      const source = Bun.file(sourcePath);
      if (!(await source.exists())) throw new Error(`Missing published declaration: ${file}`);
      await Bun.write(resolve(root, "types", file), source);
      const map = Bun.file(`${sourcePath}.map`);
      if (await map.exists()) await Bun.write(resolve(root, "types", `${file}.map`), map);
    }),
  );
  return declarations.length;
}

/** Root postinstall also prepares the resolved file-dependency artifact. */
export async function main(args: string[]): Promise<void> {
  if (args.length !== 0 && (args.length !== 2 || args[0] !== "--consumer")) {
    throw new Error("Usage: bootstrap-types.ts [--consumer <installed consumer directory>]");
  }
  const roots = new Set([SOURCE_ROOT]);
  if (args.length === 2) {
    roots.add(dirname(Bun.resolveSync("@aphrody/material-web/package.json", resolve(args[1]!))));
  }
  const results = await Promise.all(
    [...roots].map(async (root) => ({ root, declarations: await bootstrapTypes(root) })),
  );
  for (const { root, declarations } of results) {
    console.log(`material-web: prepared ${declarations} public declarations in ${root}`);
  }
}

if (import.meta.main) await main(Bun.argv.slice(2));
