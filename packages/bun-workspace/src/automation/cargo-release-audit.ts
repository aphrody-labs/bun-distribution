// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve } from "node:path";

type Dependency = {
  name: string;
  rename: string | null;
  kind: string | null;
  target: string | null;
  req: string;
  path?: string;
  source: string | null;
};
type Package = {
  id: string;
  name: string;
  version: string;
  manifest_path: string;
  publish: string[] | null;
  dependencies: Dependency[];
};
export type ReleaseMetadata = {
  workspace_root: string;
  workspace_members: string[];
  packages: Package[];
  resolve: unknown;
};
type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : {};
const compare = (a: number[], b: number[]): number => {
  for (let i = 0; i < 3; i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference) return difference;
  }
  return 0;
};

// Only default/caret requirements without prereleases are analyzed. Cargo semantics,
// including ^0 and ^0.0, differ from npm's rules. Complex ranges stay unclassified.
function caretRange(requirement: string) {
  const match = /^\^?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(requirement.trim());
  if (!match) return null;
  const floor = [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
  const ceiling = [...floor];
  const bump = floor[0] !== 0 || match[2] === undefined ? 0 : floor[1] !== 0 || match[3] === undefined ? 1 : 2;
  ceiling[bump] = (ceiling[bump] ?? 0) + 1;
  for (let index = bump + 1; index < 3; index++) ceiling[index] = 0;
  return { floor, ceiling };
}

export function classifyRequirements(requirements: string[]) {
  const unique = [...new Set(requirements)].toSorted();
  const ranges = unique.map(caretRange);
  if (ranges.some(range => range === null))
    return {
      requirements: unique,
      status: "requires-review",
      candidateMinimum: null,
    };
  const known = ranges.filter(range => range !== null);
  const low = known
    .map(range => range.floor)
    .toSorted(compare)
    .at(-1);
  const high = known.map(range => range.ceiling).toSorted(compare)[0];
  const overlaps = low !== undefined && high !== undefined && compare(low, high) < 0;
  return {
    requirements: unique,
    status: overlaps ? "overlapping-caret-ranges" : "disjoint-caret-ranges",
    candidateMinimum: overlaps ? low.join(".") : null,
  };
}

function dependencySpec(manifest: RecordValue, rootManifest: RecordValue, dep: Dependency) {
  const section =
    dep.kind === "dev" ? "dev-dependencies" : dep.kind === "build" ? "build-dependencies" : "dependencies";
  const table = dep.target ? object(object(manifest.target)[dep.target]) : manifest;
  const value = object(table[section])[dep.rename ?? dep.name];
  const spec = typeof value === "string" ? { version: value } : object(value);
  if (spec.workspace !== true) return spec;
  return object(object(object(rootManifest.workspace).dependencies)[dep.rename ?? dep.name]);
}

export async function auditCargoRelease(metadata: ReleaseMetadata, root = metadata.workspace_root) {
  root = resolve(root);
  if (resolve(metadata.workspace_root) !== root)
    throw new Error("Metadata belongs to another workspace; regenerate it for --root");
  const rootManifest = object(Bun.TOML.parse(await Bun.file(join(root, "Cargo.toml")).text()));
  const members = new Set(metadata.workspace_members);
  const packages = metadata.packages
    .filter(pkg => members.has(pkg.id))
    .toSorted((a, b) => a.name.localeCompare(b.name));
  if (packages.length !== members.size) throw new Error("Metadata is missing workspace member packages");
  const manifestHashes: Record<string, string> = {};
  const packagePolicies: {
    name: string;
    manifest: string;
    version: string;
    cratesIoAllowed: boolean;
  }[] = [];
  const locations: {
    owner: string;
    dependency: string;
    manifest: string;
    kind: string;
    req: string;
    location: string;
    source: string;
    external: boolean;
    versionMissing: boolean;
    wildcardRegistryVersion: boolean;
    publicationRequired: boolean;
    localVersion: string | null;
  }[] = [];
  const registry = new Map<string, { owner: string; req: string }[]>();
  const manifestProblems: string[] = [];
  const parsed = new Map<string, RecordValue>();
  async function manifestAt(path: string) {
    const key = resolve(path);
    const cached = parsed.get(key);
    if (cached) return cached;
    const text = await Bun.file(key).text();
    manifestHashes[relative(root, key).replaceAll("\\", "/")] = createHash("sha256").update(text).digest("hex");
    const manifest = object(Bun.TOML.parse(text));
    parsed.set(key, manifest);
    return manifest;
  }
  const manifestPaths = new Set([
    join(root, "Cargo.toml"),
    ...packages.map(pkg => pkg.manifest_path),
    ...packages.flatMap(pkg => pkg.dependencies.filter(dep => dep.path).map(dep => join(dep.path!, "Cargo.toml"))),
  ]);
  await Promise.all(
    [...manifestPaths].map(async path => {
      try {
        await manifestAt(path);
      } catch {
        manifestProblems.push(`Missing or invalid manifest: ${relative(root, path)}`);
      }
    }),
  );
  for (const pkg of packages) {
    const manifest = parsed.get(resolve(pkg.manifest_path));
    if (!manifest) throw new Error(`Cannot audit member manifest: ${pkg.manifest_path}`);
    const info = object(manifest.package);
    const manifestVersion =
      typeof info.version === "string" ? info.version : object(object(rootManifest.workspace).package).version;
    if (info.name !== pkg.name || manifestVersion !== pkg.version)
      manifestProblems.push(`${pkg.name}: stale metadata package name/version; regenerate metadata`);
    const publish =
      object(info.publish).workspace === true ? object(object(rootManifest.workspace).package).publish : info.publish;
    const allowed = publish !== false && (!Array.isArray(publish) || publish.includes("crates-io"));
    packagePolicies.push({
      name: pkg.name,
      manifest: relative(root, pkg.manifest_path).replaceAll("\\", "/"),
      version: pkg.version,
      cratesIoAllowed: allowed,
    });
    for (const dep of pkg.dependencies) {
      if (!dep.path && !dep.source?.startsWith("git+")) {
        const registryKey = `${dep.source ?? "registry-default"}\0${dep.name}`;
        const entries = registry.get(registryKey) ?? [];
        entries.push({ owner: pkg.name, req: dep.req });
        registry.set(registryKey, entries);
        continue;
      }
      const spec = dependencySpec(manifest, rootManifest, dep);
      const path = dep.path ? relative(root, resolve(dep.path)) : "";
      let localVersion: string | null = null;
      if (dep.path) {
        try {
          const target = parsed.get(resolve(dep.path, "Cargo.toml"));
          if (!target) throw new Error("Missing dependency manifest");
          const targetVersion = object(target.package).version;
          localVersion = typeof targetVersion === "string" ? targetVersion : null;
          if (object(targetVersion).workspace === true && !path.startsWith("..")) {
            const inherited = object(object(rootManifest.workspace).package).version;
            if (typeof inherited === "string") localVersion = inherited;
          }
        } catch {
          manifestProblems.push(`${pkg.name}: missing or invalid dependency manifest ${dep.path}`);
        }
      }
      locations.push({
        owner: pkg.name,
        dependency: dep.name,
        manifest: relative(root, pkg.manifest_path).replaceAll("\\", "/"),
        kind: dep.kind ?? "normal",
        req: dep.req,
        location: dep.path ? "path" : "git",
        source: dep.path ? path.replaceAll("\\", "/") : (dep.source ?? ""),
        external: Boolean(dep.path && (path === ".." || /^\.\.[\\/]/.test(path) || isAbsolute(path))),
        versionMissing: typeof spec.version !== "string",
        wildcardRegistryVersion: dep.req === "*",
        publicationRequired: dep.kind !== "dev" && allowed,
        localVersion,
      });
    }
  }
  const divergentRequirements = [...registry]
    .filter(([, entries]) => new Set(entries.map(entry => entry.req)).size > 1)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([key, entries]) =>
      Object.assign(
        {
          name: key.split("\0")[1]!,
          source: key.split("\0")[0]!,
          consumers: entries,
        },
        classifyRequirements(entries.map(entry => entry.req)),
      ),
    );
  return {
    schema: "aphrody.cargo-release-audit.v1",
    scope: "workspace-direct-declarations",
    resolutionVerified: false,
    publicationVerified: false,
    limitations: [
      "Metadata is supplied by the integrating agent; regenerate it after manifest edits.",
      "Registry availability, transitive resolution, API compatibility, packaging and builds are not checked.",
      "Caret intersections are declaration comparisons, not verified published upgrade versions.",
      "Dev dependencies are inventoried but not required for crates.io publication.",
      "External path packages with inherited workspace versions have no localVersion suggestion.",
    ],
    summary: {
      members: packages.length,
      cratesIoAllowed: packagePolicies.filter(pkg => pkg.cratesIoAllowed).length,
      pathEdges: locations.filter(dep => dep.location === "path").length,
      gitEdges: locations.filter(dep => dep.location === "git").length,
      pathWildcardEdges: locations.filter(dep => dep.location === "path" && dep.req === "*").length,
      missingRegistryVersionEdges: locations.filter(dep => dep.versionMissing && dep.publicationRequired).length,
      wildcardRegistryVersionEdges: locations.filter(dep => dep.wildcardRegistryVersion && dep.publicationRequired)
        .length,
      externalPathEdges: locations.filter(dep => dep.external).length,
      disjointDirectRequirements: divergentRequirements.filter(dep => dep.status === "disjoint-caret-ranges").length,
    },
    manifestHashes: Object.fromEntries(Object.entries(manifestHashes).toSorted(([a], [b]) => a.localeCompare(b))),
    manifestProblems: manifestProblems.toSorted(),
    packagePolicies,
    locations,
    divergentRequirements,
  };
}

export async function runCargoReleaseAudit(args: string[]): Promise<number> {
  let root: string | undefined;
  let metadataPath: string | undefined;
  let output: string | undefined;
  let check = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--root" || arg === "--metadata" || arg === "--out") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      if (arg === "--root") root = resolve(value);
      else if (arg === "--metadata") metadataPath = resolve(value);
      else output = resolve(value);
    } else if (arg === "--check") check = true;
    else if (arg === "--json") {
      /* JSON is the canonical report. */
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: yolo ops cargo-release-audit --metadata <metadata.json> [--root <workspace>] [--out <report.json>] [--check] [--json]",
      );
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!metadataPath)
    throw new Error(
      "--metadata is required; generate metadata through scripts/aphrody/build/rust/cargo-serial.sh metadata --no-deps --format-version 1",
    );
  const metadata = (await Bun.file(metadataPath).json()) as ReleaseMetadata;
  const report = await auditCargoRelease(metadata, root ?? resolve(metadata.workspace_root));
  const json = JSON.stringify(report, null, 2) + "\n";
  if (output) await Bun.write(output, json);
  else process.stdout.write(json);
  return check &&
    (report.summary.missingRegistryVersionEdges > 0 ||
      report.summary.wildcardRegistryVersionEdges > 0 ||
      report.manifestProblems.length > 0 ||
      report.summary.cratesIoAllowed !== report.summary.members)
    ? 1
    : 0;
}

if (import.meta.main) process.exit(await runCargoReleaseAudit(process.argv.slice(2)));
