// SPDX-License-Identifier: Apache-2.0
/** Stage Infra catalogs at the new monorepo root with explicit provenance. */
import { execFileSync } from "@aphrody/update/process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, join, resolve } from "node:path";

type SourceEntry = {
  source: string;
  target: string | null;
  size: number | null;
  status: string;
  sha256?: string;
  importedSha256?: string;
  importedSourceSha256?: string;
};

type CheckoutReference = {
  line: number;
  sourcePath: string;
  mappedTarget: string | null;
  targetExists: boolean;
};

function git(root: string, args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
}

function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function classifyHost(host: string): string {
  const lower = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (lower === "localhost" || lower === "127.0.0.1" || lower === "::1")
    return "loopback";
  if (lower.includes("${") || lower.startsWith("$"))
    return "environment-template";
  if (isIP(lower) === 4) {
    if (
      /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.)/.test(lower)
    )
      return "private-network";
    return "public-ip-literal";
  }
  if (isIP(lower) === 6)
    return /^(?:f[cd]|fe[89ab])/.test(lower) ? "private-network" : "ip-literal";
  if (lower.includes(":")) return "compound-host-alias";
  if (lower.endsWith(".local") || lower.endsWith(".internal"))
    return "private-name";
  return lower.includes(".") ? "fqdn-unverified" : "host-alias";
}

function endpointClasses(value: unknown): Record<string, number> {
  const counts = new Map<string, number>();
  function visit(item: unknown): void {
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
    } else if (item && typeof item === "object") {
      for (const child of Object.values(item)) visit(child);
    } else if (typeof item === "string") {
      let host: string | null = null;
      if (/^https?:\/\//i.test(item)) {
        try {
          host = new URL(item).hostname;
        } catch {
          return;
        }
      } else {
        const match = /^([^/\s]+):\d{2,5}$/.exec(item);
        if (match) host = match[1]!;
      }
      if (host) {
        const kind = classifyHost(host);
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
      }
    }
  }
  visit(value);
  return Object.fromEntries(
    [...counts].toSorted(([a], [b]) => a.localeCompare(b)),
  );
}

function textEndpointClasses(text: string): Record<string, number> {
  const counts = new Map<string, number>();
  const tokens = text.matchAll(
    /https?:\/\/[^\s"'<>]+|(?:localhost|127\.0\.0\.1|\[::1\]|[A-Za-z][A-Za-z0-9.-]*):\d{2,5}/g,
  );
  for (const match of tokens) {
    const token = match[0].replace(/[),;]+$/, "");
    let host: string;
    try {
      host = token.startsWith("http")
        ? new URL(token).hostname
        : token.slice(0, token.lastIndexOf(":"));
    } catch {
      continue;
    }
    const kind = classifyHost(host);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return Object.fromEntries(
    [...counts].toSorted(([a], [b]) => a.localeCompare(b)),
  );
}

function remap(
  path: string,
  source: Buffer,
): { bytes: Buffer; remaps: string[]; endpoints: Record<string, number> } {
  if (!path.endsWith(".json"))
    return {
      bytes: source,
      remaps: [],
      endpoints: textEndpointClasses(source.toString("utf8")),
    };
  const value = JSON.parse(source.toString("utf8")) as Record<string, unknown>;
  const endpoints = endpointClasses(value);
  const remaps: string[] = [];
  if (path === "tools/config/pipeline.json") {
    if (value.workspaceRoot !== "../")
      throw new Error(
        "unexpected pipeline.workspaceRoot; review source before import",
      );
    value.workspaceRoot = ".";
    remaps.push("workspaceRoot: ../ -> .");
  }
  if (path === "tools/config/google-stack-release.json") {
    const repositories = value.sourceRepositories as Record<string, unknown>;
    if (
      repositories?.ai !== "../aphrody-ai" ||
      repositories?.web !== "../aphrody-web"
    )
      throw new Error(
        "unexpected google-stack sourceRepositories; review source before import",
      );
    repositories.ai = "./aphrody-ai";
    repositories.web = "./aphrody-web";
    remaps.push("sourceRepositories.ai: ../aphrody-ai -> ./aphrody-ai");
    remaps.push("sourceRepositories.web: ../aphrody-web -> ./aphrody-web");
  }
  return {
    bytes: remaps.length
      ? Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
      : source,
    remaps,
    endpoints,
  };
}

function checkoutReferences(
  bytes: Buffer,
  sourceEntries: Map<string, SourceEntry>,
  targetRoot: string,
): CheckoutReference[] {
  const references: CheckoutReference[] = [];
  for (const [index, line] of bytes.toString("utf8").split(/\r?\n/).entries()) {
    const matches = line.matchAll(
      /\/home\/(?:aphro\/src|ubuntu)\/aphrody-infra(?:\/[A-Za-z0-9._/-]+)?/g,
    );
    for (const match of matches) {
      const original = match[0].replace(/[.,;]+$/, "");
      const suffix = original.replace(
        /^\/home\/(?:aphro\/src|ubuntu)\/aphrody-infra\/?/,
        "",
      );
      const sourcePath = suffix ? `aphrody-infra/${suffix}` : "aphrody-infra";
      const mappedTarget = sourceEntries.get(sourcePath)?.target ?? null;
      references.push({
        line: index + 1,
        sourcePath,
        mappedTarget,
        targetExists: mappedTarget
          ? existsSync(join(targetRoot, mappedTarget))
          : false,
      });
    }
  }
  return references;
}

export async function importInfraConfig(
  sourceRoot: string,
  targetRoot: string,
): Promise<Record<string, unknown>> {
  const source = resolve(sourceRoot, "aphrody-infra");
  const target = resolve(targetRoot);
  const paths = git(source, [
    "ls-files",
    "-z",
    "--",
    "config",
    "inventory",
    "systemd",
    "rust-toolchain.toml",
  ])
    .split("\0")
    .filter(Boolean)
    .toSorted();
  const dirty = git(source, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--",
    "config",
    "inventory",
    "systemd",
    "rust-toolchain.toml",
  ]);
  if (dirty)
    throw new Error(
      "Infra configuration source is dirty; review it before import",
    );
  const sourceHead = git(source, ["rev-parse", "HEAD"]).trim();
  const mapPath = join(target, "docs/migration/source-map.json");
  const sourceMap = JSON.parse(await readFile(mapPath, "utf8")) as {
    entries: SourceEntry[];
  };
  const bySource = new Map(
    sourceMap.entries.map((entry) => [entry.source, entry]),
  );
  const planned: Array<{
    path: string;
    sourceSize: number;
    sourceHash: string;
    targetHash: string;
    bytes: Buffer;
    remaps: string[];
    endpoints: Record<string, number>;
    sourceCheckoutReferences: CheckoutReference[];
    entry: SourceEntry;
    existing: boolean;
  }> = [];
  for (const path of paths) {
    if (
      !path.startsWith("config/") &&
      !path.startsWith("inventory/") &&
      !path.startsWith("systemd/") &&
      path !== "rust-toolchain.toml"
    )
      throw new Error(`unexpected configuration path: ${path}`);
    const entry = bySource.get(`aphrody-infra/${path}`);
    if (!entry) throw new Error(`catalog absent from source map: ${path}`);
    // oxlint-disable-next-line no-await-in-loop -- catalog entries are read in order, failing on the first missing source
    const sourceBytes = await readFile(join(source, path));
    const sourceHash = hash(sourceBytes);
    const transformed = remap(path, sourceBytes);
    const targetHash = hash(transformed.bytes);
    const destination = resolve(target, path);
    if (!destination.startsWith(`${target}/`))
      throw new Error(`catalog path escapes target: ${path}`);
    const existing = existsSync(destination);
    if (existing) {
      // oxlint-disable-next-line no-await-in-loop -- existing destinations are hashed one at a time before the write decision for each entry
      const existingHash = hash(await readFile(destination));
      if (
        existingHash !== targetHash ||
        (entry.importedSha256 && entry.importedSha256 !== existingHash)
      )
        throw new Error(`catalog target conflict: ${path}`);
      if (
        entry.importedSourceSha256 &&
        entry.importedSourceSha256 !== sourceHash
      )
        throw new Error(`catalog source changed since import: ${path}`);
    }
    planned.push({
      path,
      sourceSize: sourceBytes.length,
      sourceHash,
      targetHash,
      bytes: transformed.bytes,
      remaps: transformed.remaps,
      endpoints: transformed.endpoints,
      sourceCheckoutReferences: checkoutReferences(
        sourceBytes,
        bySource,
        target,
      ),
      entry,
      existing,
    });
  }
  if (
    git(source, ["rev-parse", "HEAD"]).trim() !== sourceHead ||
    git(source, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      "config",
      "inventory",
      "systemd",
      "rust-toolchain.toml",
    ])
  )
    throw new Error("Infra catalogs changed during preflight; import aborted");
  for (const item of planned) {
    const destination = resolve(target, item.path);
    if (!item.existing) {
      // oxlint-disable-next-line no-await-in-loop -- entries are written in catalog order; each directory and file write must finish before the next entry
      await mkdir(dirname(destination), { recursive: true });
      // oxlint-disable-next-line no-await-in-loop -- entries are written in catalog order; each directory and file write must finish before the next entry
      await writeFile(destination, item.bytes, { flag: "wx" });
    }
    item.entry.target = item.path;
    item.entry.size = item.sourceSize;
    item.entry.status = "clean";
    item.entry.sha256 = item.sourceHash;
    item.entry.importedSourceSha256 = item.sourceHash;
    item.entry.importedSha256 = item.targetHash;
  }
  await writeFile(mapPath, `${JSON.stringify(sourceMap)}\n`);
  const report = {
    observedAt: new Date().toISOString(),
    sourceHead,
    sourcePath: source,
    targetPath: target,
    fileCount: planned.length,
    copied: planned.filter((item) => !item.existing).length,
    identical: planned.filter((item) => item.existing).length,
    policy:
      "Only tracked clean Infra catalogs, systemd declarations and toolchain pin; existing target files must match recorded transformed bytes. Runtime host endpoints are preserved. Relative source-workspace references remain transitional.",
    files: planned.map((item) => ({
      source: `aphrody-infra/${item.path}`,
      target: item.path,
      sourceSha256: item.sourceHash,
      targetSha256: item.targetHash,
      remaps: item.remaps,
      endpointClasses: item.endpoints,
      sourceCheckoutReference: item.sourceCheckoutReferences.length > 0,
      sourceCheckoutReferences: item.sourceCheckoutReferences,
    })),
  };
  await writeFile(
    join(target, "docs/migration/infra-config-import.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return {
    fileCount: report.fileCount,
    copied: report.copied,
    identical: report.identical,
    remappedFiles: planned.filter((item) => item.remaps.length).length,
    report: "docs/migration/infra-config-import.json",
  };
}
