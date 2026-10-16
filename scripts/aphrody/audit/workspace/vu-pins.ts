// SPDX-License-Identifier: Apache-2.0
//! Consistency gate of the pins of the vu runtime (docs/plans/vu/PLAN.md).
//!
//!   bun scripts/audit/workspace/vu-pins.ts [--online] [--vu <checkout>] [--json]
//!
//! Offline, `docs/plans/vu/scaffold/vendor.json` (pins of the planned vu monorepo),
//! `docs/plans/vu/scaffold/vu.json` (the single place of the runtime name) and
//! `tools/config/upstream-sources.json` (provenance of the forks) must describe the same revisions and the same
//! branch names. With `--online` the fork branches and the upstream tags are read through
//! `aphrody git api` and must resolve to the pinned commit. With `--vu <checkout>` the files `vendor.json` and
//! `vu.json` of the private vu repository must be byte-identical to the mirror kept here.

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../../../docs/aphrody");
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;

export interface Identity {
  name: string;
  derived: Record<string, string>;
}

export interface VendorSource {
  name: string;
  url: string;
  upstream: string;
  upstreamTag: string;
  ref: string;
  forkBranch: string;
  cratesIo?: { cargoVcsInfoSha1?: string };
}

export interface VendorRelease {
  name: string;
  tag: string;
  commit: string;
  assets: { name: string; sha256: string }[];
}

export interface Vendor {
  sources: VendorSource[];
  releases: VendorRelease[];
}

interface Reference {
  id: string;
  tier?: string;
  ref?: string;
  observedCommit?: string;
  forkUrl?: string;
  forkRef?: string;
  forkCommit?: string;
}

export interface UpstreamSources {
  reference?: Reference[];
}

/** `{name}`, `{NAME}`, `{version}`, `{source}` ... placeholders of a derived name. */
export function expand(template: string, values: Record<string, string>): string {
  return template.replace(/\{([A-Za-z0-9]+)\}/g, (match, key: string) => {
    if (key === "NAME") return (values["name"] ?? "").toUpperCase();
    return values[key] ?? match;
  });
}

const stripV = (tag: string): string => tag.replace(/^v/, "");

/** Every inconsistency between the identity, the vendor pins and the provenance manifest. */
export function checkPins(identity: Identity, vendor: Vendor, upstream: UpstreamSources): string[] {
  const problems: string[] = [];
  if (!/^[a-z][a-z0-9]*$/.test(identity.name)) {
    problems.push(`vu.json: invalid runtime name "${identity.name}"`);
  }
  const references = new Map((upstream.reference ?? []).map((entry) => [entry.id, entry]));
  const forkIds = new Set<string>();
  for (const source of vendor.sources) {
    const where = `vendor.json ${source.name}`;
    if (!SHA.test(source.ref)) problems.push(`${where}: ref must be a 40-hex commit`);
    const repo = source.url.match(/^https:\/\/github\.com\/aphrody-labs\/([^/]+?)(?:\.git)?$/)?.[1];
    if (!repo) problems.push(`${where}: url must be an aphrody-labs fork`);
    const branch = expand(identity.derived["forkPinBranch"] ?? "", {
      name: identity.name,
      version: stripV(source.upstreamTag),
    });
    if (source.forkBranch !== branch) {
      problems.push(`${where}: forkBranch ${source.forkBranch} must be ${branch}`);
    }
    const vcs = source.cratesIo?.cargoVcsInfoSha1;
    if (vcs !== undefined && vcs !== source.ref) {
      problems.push(`${where}: crates.io vcs sha ${vcs} differs from ref ${source.ref}`);
    }
    const id = expand(identity.derived["upstreamSourcesId"] ?? "", {
      name: identity.name,
      source: source.name,
    });
    forkIds.add(id);
    const entry = references.get(id);
    if (!entry) {
      problems.push(`tools/config/upstream-sources.json: missing reference ${id}`);
      continue;
    }
    if (entry.tier !== "build") problems.push(`${id}: tier must be build`);
    if (entry.ref !== source.upstreamTag) problems.push(`${id}: ref must be ${source.upstreamTag}`);
    if (entry.observedCommit !== source.ref)
      problems.push(`${id}: observedCommit must be ${source.ref}`);
    if (entry.forkCommit !== source.ref) problems.push(`${id}: forkCommit must be ${source.ref}`);
    if (entry.forkRef !== source.forkBranch)
      problems.push(`${id}: forkRef must be ${source.forkBranch}`);
    if (repo && entry.forkUrl !== `https://github.com/aphrody-labs/${repo}`) {
      problems.push(`${id}: forkUrl must be https://github.com/aphrody-labs/${repo}`);
    }
  }
  for (const release of vendor.releases) {
    const where = `vendor.json release ${release.name}`;
    if (!SHA.test(release.commit)) problems.push(`${where}: commit must be a 40-hex SHA`);
    const names = new Set<string>();
    for (const asset of release.assets) {
      if (!DIGEST.test(asset.sha256))
        problems.push(`${where}: ${asset.name} needs a sha256 digest`);
      if (names.has(asset.name)) problems.push(`${where}: duplicate asset ${asset.name}`);
      names.add(asset.name);
    }
    const id = expand(identity.derived["upstreamSourcesId"] ?? "", {
      name: identity.name,
      source: release.name,
    });
    const entry = references.get(id);
    if (!entry) problems.push(`tools/config/upstream-sources.json: missing reference ${id}`);
    else if (entry.ref !== release.tag || entry.observedCommit !== release.commit) {
      problems.push(`${id}: ref and observedCommit must be the release tag and commit`);
    }
  }
  // The runtime owns its prefix: no reference of the family may exist without a pin.
  const prefix = expand(identity.derived["upstreamSourcesId"] ?? "", {
    name: identity.name,
    source: "",
  });
  const known = new Set([
    ...forkIds,
    ...vendor.releases.map((r) =>
      expand(identity.derived["upstreamSourcesId"] ?? "", { name: identity.name, source: r.name }),
    ),
  ]);
  for (const id of references.keys()) {
    if (id.startsWith(prefix) && !known.has(id))
      problems.push(`tools/config/upstream-sources.json: ${id} has no pin in vendor.json`);
  }
  return problems;
}

/** The pins and the identity of the vu repository must be the files mirrored in docs/plans/vu/scaffold. */
export async function checkMirror(
  vuDir: string,
  mirrorDir = `${ROOT}/docs/plans/vu/scaffold`,
  files = ["vendor.json", "vu.json"],
): Promise<string[]> {
  const results = await Promise.all(
    files.map(async (name) => {
      const actual = Bun.file(`${vuDir}/${name}`);
      if (!(await actual.exists())) return `vu repository: ${name} is missing`;
      const [mine, theirs] = await Promise.all([
        actual.text(),
        Bun.file(`${mirrorDir}/${name}`).text(),
      ]);
      return mine === theirs
        ? undefined
        : `vu repository: ${name} differs from the mirror in docs/plans/vu/scaffold`;
    }),
  );
  return results.filter((problem): problem is string => problem !== undefined);
}

function api(route: string): unknown {
  const result = spawnSync("aphrody", ["git", "api", route], {
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`${route}: ${result.stderr.trim().slice(0, 200)}`);
  const parsed = JSON.parse(result.stdout) as { status?: number; body?: unknown };
  return parsed.body ?? parsed;
}

/** Remote checks: the fork branch and the upstream tag resolve to the pinned commit. */
export function checkRemote(vendor: Vendor, read: (route: string) => unknown = api): string[] {
  const problems: string[] = [];
  for (const source of vendor.sources) {
    const repo = source.url.match(/\/aphrody-labs\/([^/]+?)(?:\.git)?$/)?.[1];
    const upstream = source.upstream.match(/github\.com\/([^/]+\/[^/.]+)/)?.[1];
    try {
      const branch = read(`/repos/aphrody-labs/${repo}/branches/${source.forkBranch}`) as {
        commit?: { sha?: string };
      };
      if (branch.commit?.sha !== source.ref)
        problems.push(`${source.name}: fork branch ${source.forkBranch} is ${branch.commit?.sha}`);
      const tag = read(`/repos/${upstream}/commits/${source.upstreamTag}`) as { sha?: string };
      if (tag.sha !== source.ref)
        problems.push(`${source.name}: upstream tag ${source.upstreamTag} is ${tag.sha}`);
    } catch (error) {
      problems.push(`${source.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return problems;
}

async function main(argv: string[]): Promise<number> {
  const identity = (await Bun.file(`${ROOT}/docs/plans/vu/scaffold/vu.json`).json()) as Identity;
  const vendor = (await Bun.file(`${ROOT}/docs/plans/vu/scaffold/vendor.json`).json()) as Vendor;
  const upstream = (await Bun.file(
    `${ROOT}/tools/config/upstream-sources.json`,
  ).json()) as UpstreamSources;
  const problems = checkPins(identity, vendor, upstream);
  if (argv.includes("--online")) problems.push(...checkRemote(vendor));
  const vuIndex = argv.indexOf("--vu");
  if (vuIndex >= 0) {
    const vuDir = argv[vuIndex + 1];
    if (!vuDir) problems.push("--vu needs a checkout directory");
    else problems.push(...(await checkMirror(vuDir)));
  }
  if (argv.includes("--json")) {
    console.log(
      JSON.stringify(
        { schema: "aphrody.vu-pins/1", name: identity.name, ok: problems.length === 0, problems },
        null,
        2,
      ),
    );
  } else {
    for (const problem of problems) console.log(`error ${problem}`);
    console.log(
      problems.length === 0
        ? `vu-pins: ok (${vendor.sources.length} forks, ${vendor.releases.length} release)`
        : `vu-pins: FAILED (${problems.length})`,
    );
  }
  return problems.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
