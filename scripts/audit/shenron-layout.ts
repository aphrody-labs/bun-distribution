// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface FileRecord {
  target: string;
  target_sha256: string;
}

interface ImportRecord {
  source_file_count: number;
  target_file_count: number;
  files: FileRecord[];
  qualifications: string[];
}

const root = resolve(import.meta.dir, "../..");
const record = JSON.parse(
  readFileSync(resolve(root, "docs/migration/shenron-workspace-import.json"), "utf8"),
) as ImportRecord;
const rootManifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  workspaces: { packages: string[]; catalog?: Record<string, string> };
};

for (const pattern of ["packages/shenron/*", "apps/shenron/*"]) {
  if (!rootManifest.workspaces.packages.includes(pattern))
    throw new Error(`Missing workspace pattern: ${pattern}`);
}

if (record.files.length !== record.target_file_count || record.source_file_count !== 3147) {
  throw new Error("Shenron import record file count differs from the qualified source snapshot");
}

for (const file of record.files) {
  const path = resolve(root, file.target);
  if (!path.startsWith(`${root}/apps/shenron/`) && !path.startsWith(`${root}/packages/shenron/`)) {
    throw new Error(`Shenron target escapes its domain: ${file.target}`);
  }
  const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (digest !== file.target_sha256)
    throw new Error(`Shenron target changed since qualification: ${file.target}`);
}

for (const [kind, names] of [
  ["packages", ["api", "auth", "config", "db", "images", "pipeline", "ui"]],
  ["apps", ["bot", "site"]],
] as const) {
  for (const name of names) {
    const manifest = JSON.parse(
      readFileSync(resolve(root, kind, "shenron", name, "package.json"), "utf8"),
    ) as {
      name: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    if (manifest.name !== `@shenron/${name}`)
      throw new Error(`Unexpected Shenron package name: ${manifest.name}`);
    for (const dependencies of [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.peerDependencies,
    ]) {
      for (const [dependency, version] of Object.entries(dependencies ?? {})) {
        if (version === "catalog:" && !rootManifest.workspaces.catalog?.[dependency])
          throw new Error(`${manifest.name} references missing root catalog entry ${dependency}`);
        if (dependency.startsWith("@shenron/") && version !== "workspace:*") {
          throw new Error(`${manifest.name} does not use the Aphrody workspace for ${dependency}`);
        }
      }
    }
  }
}

if (!record.qualifications.some((entry) => entry.includes("root catalog")))
  throw new Error("Shenron import record does not document Aphrody root catalog alignment");

console.log(`Shenron layout: 9 workspaces and ${record.files.length} qualified files`);
