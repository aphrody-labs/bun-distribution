#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable no-await-in-loop -- Archive creation is serialized; scanning bounds subprocess memory. */
/** Audit the actual npm payload, never the workspace symlink tree. */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, posix } from "node:path";
import { firstPartyManifests } from "@aphrody/update/manifests";

type Manifest = {
  name: string;
  version: string;
  private?: boolean;
  files?: string[];
  license?: string;
  exports?: unknown;
  imports?: unknown;
  main?: string;
  module?: string;
  types?: string;
  bin?: unknown;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
export type PackageAudit = {
  path: string;
  name: string;
  version: string;
  archive: string;
  sha256: string;
  files: number;
  errors: string[];
};

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

export function auditPayload(manifest: Manifest, files: string[]): string[] {
  const errors: string[] = [];
  if (!manifest.files?.length) errors.push("missing explicit files allowlist");
  if (!manifest.license) errors.push("missing license metadata");
  const entries = [
    manifest.exports,
    manifest.imports,
    manifest.main,
    manifest.module,
    manifest.types,
    manifest.bin,
  ].flatMap(strings);
  if (!entries.length) errors.push("no library or executable entrypoint");
  for (const entry of entries) {
    if (entry === null || entry.startsWith("node:")) continue;
    const path = entry.replace(/^\.\//, "");
    if (!files.some(file => new Bun.Glob(path).match(file))) errors.push(`missing entry: ${entry}`);
  }
  for (const section of ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies"] as const) {
    for (const [name, spec] of Object.entries(manifest[section] ?? {})) {
      if (/^(workspace|catalog|file|link):/.test(spec)) errors.push(`local dependency: ${name}=${spec}`);
    }
  }
  for (const file of files) {
    if (
      file.startsWith("/") ||
      file.split("/").includes("..") ||
      /(^|\/)(\.env(?:\.[^/]+)?|\.npmrc|\.git|node_modules)(\/|$)|\.(sqlite(?:3)?|db|pem|key)$/.test(file)
    ) {
      errors.push(`protected filename: ${file}`);
    }
  }
  return [...new Set(errors)];
}

async function checked(command: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(command, {
    windowsHide: true,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`${command[0]} failed (${code}): ${stderr.slice(-2000)}`);
  return stdout;
}

export async function auditPackages(root: string, output: string, only?: string[]): Promise<PackageAudit[]> {
  await mkdir(output, { recursive: true });
  const audits: PackageAudit[] = [];
  for (const path of await firstPartyManifests(root)) {
    const manifest: Manifest = await Bun.file(join(root, path)).json();
    if (manifest.private || (only && !only.includes(manifest.name))) continue;
    const archive = join(output, `${manifest.name.replace(/^@/, "").replaceAll("/", "-")}-${manifest.version}.tgz`);
    const row: PackageAudit = {
      path,
      name: manifest.name,
      version: manifest.version,
      archive,
      sha256: "",
      files: 0,
      errors: [],
    };
    try {
      // Lifecycle scripts run: a failing prepack is a release failure.
      await checked(["bun", "pm", "pack", "--filename", archive, "--quiet"], dirname(join(root, path)));
      // Bun.Archive rather than tar: GNU tar reads a "C:\..." archive path as a remote host.
      const entries = await new Bun.Archive(await Bun.file(archive).bytes()).files();
      const names = [...entries.keys()];
      if (names.some(name => !name.startsWith("package/"))) throw new Error("archive contains paths outside package/");
      const packed: Manifest = JSON.parse(await entries.get("package/package.json")!.text());
      row.files = names.length;
      row.errors = auditPayload(
        packed,
        names.map(name => name.slice("package/".length)),
      );
      const files = names.map(name => name.slice("package/".length));
      for (const file of files) {
        if (
          !/\.[cm]?[jt]sx?$/.test(file) ||
          /\.(?:test|spec|d)\.[cm]?[jt]sx?$/.test(file) ||
          file.startsWith("vendor/")
        )
          continue;
        const source = await entries.get(`package/${file}`)!.text();
        const loader = file.endsWith("tsx") ? "tsx" : file.endsWith("jsx") ? "jsx" : file.endsWith(".ts") ? "ts" : "js";
        let imports;
        try {
          imports = new Bun.Transpiler({ loader }).scan(source).imports;
        } catch (error) {
          throw new Error(`${file}: ${String(error)}`, { cause: error });
        }
        for (const { path: specifier } of imports) {
          if (!specifier.startsWith(".")) continue;
          const target = posix.normalize(posix.join(posix.dirname(file), specifier.split("?")[0]!));
          const candidates = [
            target,
            `${target}.ts`,
            `${target}.tsx`,
            `${target}.js`,
            `${target}/index.ts`,
            `${target}/index.tsx`,
            `${target}/index.js`,
            target.replace(/\.js$/, ".ts"),
            target.replace(/\.js$/, ".tsx"),
          ];
          if (!candidates.some(candidate => files.includes(candidate)))
            row.errors.push(`unpacked import: ${file} -> ${specifier}`);
        }
      }
      row.sha256 = new Bun.CryptoHasher("sha256").update(await Bun.file(archive).arrayBuffer()).digest("hex");
    } catch (error) {
      row.errors = [String(error)];
    }
    audits.push(row);
    console.log(
      `${row.errors.length ? "FAIL" : "PASS"} ${row.name}@${row.version}${row.errors.length ? `: ${row.errors.join("; ")}` : ""}`,
    );
  }
  if (only)
    for (const name of only)
      if (!audits.some(row => row.name === name)) throw new Error(`unknown or private package: ${name}`);
  await Bun.write(join(output, "audit.json"), `${JSON.stringify(audits, null, 2)}\n`);
  return audits;
}

if (import.meta.main) {
  const command = Bun.argv[2] ?? "audit";
  if (command !== "audit") throw new Error("usage: bun run packages:audit [--only name,name] [--out directory]");
  const root = resolve(import.meta.dir, "../../../");
  const outIndex = Bun.argv.indexOf("--out");
  const onlyIndex = Bun.argv.indexOf("--only");
  const output = outIndex >= 0 ? resolve(Bun.argv[outIndex + 1]!) : await mkdtemp(join(tmpdir(), "aphrody-npm-audit-"));
  const only = onlyIndex >= 0 ? Bun.argv[onlyIndex + 1]!.split(",") : undefined;
  const rows = await auditPackages(root, output, only);
  console.log(
    `${rows.length} archives, ${rows.filter(row => row.errors.length).length} failures. Receipt: ${join(output, "audit.json")}`,
  );
  // Do not retain an unsafe archive that could be published by mistake.
  for (const row of rows) if (row.errors.length) await rm(row.archive, { force: true });
  process.exitCode = rows.some(row => row.errors.length) ? 1 : 0;
}
