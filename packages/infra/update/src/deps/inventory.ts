// SPDX-License-Identifier: Apache-2.0
/**
 * Whole-repo dependency inventory across every registry the repo touches.
 *
 *  - Rust:   Cargo.lock (all packages) vs the crates.io sparse index (latest, yanked); git sources via `git ls-remote`
 *            (host agnostic: GitHub, GitLab, googlesource, ...); first-party crates checked for version drift and
 *            for name collisions on crates.io.
 *  - Bun:    every package.json (+ catalog) resolved through bun.lock vs the npm registry (latest, deprecated).
 *  - Python: pyproject/requirements/uv.lock under the configured roots vs PyPI (latest, yanked).
 *  - Security: OSV.dev batch query for every resolved crates.io / npm / PyPI version.
 *
 * Read-only. Responses are cached for six hours under target/deps-inventory/cache.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { spawnSync } from "../process.ts";
import { cmpVersion } from "./sync.ts";

export type Dep = { ecosystem: "crates.io" | "npm" | "PyPI"; name: string; version: string };
export type Row = Dep & {
  latest?: string;
  behind?: boolean;
  yanked?: boolean;
  deprecated?: string;
  vulns?: string[];
  direct?: boolean;
};
export type GitRow = {
  url: string;
  pinned: string[];
  head?: string;
  latestTag?: string;
  stale?: boolean;
};

const UA = { "user-agent": "aphrody-deps-inventory (contact@aphrody.com)" };
const TTL_MS = 6 * 3600 * 1000;

// ---------------------------------------------------------------- helpers

export async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  out.length = items.length;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        // oxlint-disable-next-line no-await-in-loop -- pool à concurrence bornée : chaque worker traite sa file séquentiellement
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

export function sparsePath(name: string): string {
  const n = name.toLowerCase();
  if (n.length === 1) return `1/${n}`;
  if (n.length === 2) return `2/${n}`;
  if (n.length === 3) return `3/${n[0]}/${n}`;
  return `${n.slice(0, 2)}/${n.slice(2, 4)}/${n}`;
}

/** Parse the [[package]] blocks of a Cargo.lock. */
export function parseCargoLock(text: string): { name: string; version: string; source?: string }[] {
  const pkgs: { name: string; version: string; source?: string }[] = [];
  for (const block of text.split("[[package]]").slice(1)) {
    const name = /^name = "([^"]+)"/m.exec(block)?.[1];
    const version = /^version = "([^"]+)"/m.exec(block)?.[1];
    const source = /^source = "([^"]+)"/m.exec(block)?.[1];
    if (name && version) pkgs.push({ name, version, source });
  }
  return pkgs;
}

/** Resolved name@version pairs from a bun.lock (JSONC, one package per line). */
export function parseBunLock(text: string): Dep[] {
  const out = new Map<string, Dep>();
  for (const m of text.matchAll(/^\s{4}"[^"]+":\s*\["((?:@[^/"]+\/)?[^@"]+)@([^"@,]+)"/gm)) {
    const [, name, version] = m;
    if (name && version && /^\d/.test(version))
      out.set(`${name}@${version}`, { ecosystem: "npm", name, version });
  }
  return [...out.values()];
}

export function parseRequirements(text: string): { name: string; version: string }[] {
  return text.split("\n").flatMap((l) => {
    const m = /^([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?==([0-9][^\s;\\]*)/.exec(l.trim());
    return m ? [{ name: m[1]!.toLowerCase().replace(/_/g, "-"), version: m[2]! }] : [];
  });
}

export function parseUvLock(text: string): { name: string; version: string }[] {
  return parseCargoLock(text).map(({ name, version }) => ({ name, version }));
}

export function gitSources(pkgs: { name: string; source?: string }[]): Map<string, Set<string>> {
  const repos = new Map<string, Set<string>>();
  for (const p of pkgs) {
    const m = /^git\+([^?#]+)(?:\?[^#]*)?#?([0-9a-f]{7,40})?/.exec(p.source ?? "");
    if (!m) continue;
    const url = m[1]!.replace(/\.git$/, "");
    (repos.get(url) ?? repos.set(url, new Set()).get(url)!).add(m[2] ?? "");
  }
  return repos;
}

// ---------------------------------------------------------------- cached fetch

export class Cache {
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
  }
  private file(key: string) {
    return join(this.dir, key.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 180));
  }
  get(key: string): string | undefined {
    const f = this.file(key);
    if (!existsSync(f) || Date.now() - statSync(f).mtimeMs > TTL_MS) return undefined;
    return readFileSync(f, "utf8");
  }
  set(key: string, v: string) {
    writeFileSync(this.file(key), v);
  }
}

export async function cachedText(
  cache: Cache,
  url: string,
  init?: RequestInit,
): Promise<string | undefined> {
  const hit = cache.get(url);
  if (hit !== undefined) return hit === "\u0000404" ? undefined : hit;
  let res: Response | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    // oxlint-disable-next-line no-await-in-loop -- relances séquentielles avec backoff : la tentative suivante dépend de la précédente
    res = await fetch(url, {
      ...init,
      headers: { ...UA, ...(init?.headers as object) },
      signal: AbortSignal.timeout(30_000),
    }).catch(() => undefined);
    if (res && res.status !== 429 && res.status < 500) break;
    const wait = Math.min(60, Number(res?.headers.get("retry-after")) || 2 ** attempt * 2); // honour Retry-After, else exponential backoff
    // oxlint-disable-next-line no-await-in-loop -- attente de Retry-After entre deux relances séquentielles
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
  if (!res) return undefined;
  if (res.status === 404) {
    cache.set(url, "\u0000404");
    return undefined;
  }
  if (!res.ok) return undefined;
  const text = await res.text();
  cache.set(url, text);
  return text;
}

// ---------------------------------------------------------------- registries

async function crateInfo(
  cache: Cache,
  name: string,
): Promise<{ latest?: string; yanked: Set<string>; exists: boolean }> {
  const text = await cachedText(cache, `https://index.crates.io/${sparsePath(name)}`);
  if (!text) return { yanked: new Set(), exists: false };
  const yanked = new Set<string>();
  let latest: string | undefined;
  for (const line of text.trim().split("\n")) {
    const v = JSON.parse(line) as { vers: string; yanked: boolean };
    if (v.yanked) {
      yanked.add(v.vers);
      continue;
    }
    if (!v.vers.includes("-") && (!latest || cmpVersion(latest, v.vers) < 0)) latest = v.vers;
  }
  return { latest, yanked, exists: true };
}

async function npmInfo(
  cache: Cache,
  name: string,
): Promise<{ latest?: string; deprecated?: string }> {
  const text = await cachedText(
    cache,
    `https://registry.npmjs.org/${name.replace("/", "%2f")}/latest`,
  );
  if (!text) return {};
  const d = JSON.parse(text) as { version?: string; deprecated?: string };
  return { latest: d.version, deprecated: d.deprecated };
}

async function pypiInfo(
  cache: Cache,
  name: string,
  version: string,
): Promise<{ latest?: string; yanked: boolean }> {
  const text = await cachedText(cache, `https://pypi.org/pypi/${name}/json`);
  if (!text) return { yanked: false };
  const d = JSON.parse(text) as {
    info: { version: string };
    releases?: Record<string, { yanked?: boolean }[]>;
  };
  return { latest: d.info.version, yanked: !!d.releases?.[version]?.some((f) => f.yanked) };
}

export async function osv(deps: Dep[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (let i = 0; i < deps.length; i += 1000) {
    const chunk = deps.slice(i, i + 1000);
    // oxlint-disable-next-line no-await-in-loop -- lots OSV séquentiels pour respecter la limite de débit de l'API
    const res = await fetch("https://api.osv.dev/v1/querybatch", {
      method: "POST",
      headers: { ...UA, "content-type": "application/json" },
      body: JSON.stringify({
        queries: chunk.map((d) => ({
          package: { name: d.name, ecosystem: d.ecosystem },
          version: d.version,
        })),
      }),
      signal: AbortSignal.timeout(120_000),
    }).catch(() => undefined);
    if (!res?.ok) continue;
    // oxlint-disable-next-line no-await-in-loop -- lecture de la réponse du lot OSV courant avant d'émettre le lot suivant
    const body = (await res.json()) as { results: { vulns?: { id: string }[] }[] };
    body.results.forEach((r, j) => {
      if (r.vulns?.length)
        out.set(
          `${chunk[j]!.ecosystem}:${chunk[j]!.name}@${chunk[j]!.version}`,
          r.vulns.map((v) => v.id),
        );
    });
  }
  return out;
}

export function lsRemote(url: string): { head?: string; latestTag?: string } {
  const r = spawnSync("git", ["ls-remote", "--tags", "--refs", url, "HEAD"], {
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (r.status !== 0) return {};
  let head: string | undefined;
  let latestTag: string | undefined;
  for (const l of r.stdout.split("\n")) {
    const [sha, ref] = l.split("\t");
    if (ref === "HEAD") head = sha;
    const t = /^refs\/tags\/(?:[\w.-]*?[-@v])?(\d+\.\d+\.\d+(?:-[\w.]+)?)$/.exec(ref ?? "");
    if (t && (!latestTag || cmpVersion(latestTag, t[1]!) < 0))
      latestTag = ref!.replace("refs/tags/", "");
  }
  const head2 = spawnSync("git", ["ls-remote", url, "HEAD"], {
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  head = head2.stdout.split("\t")[0] || head;
  return { head, latestTag };
}

// ---------------------------------------------------------------- repo scan

function walk(
  root: string,
  match: (f: string) => boolean,
  out: string[] = [],
  skip = new Set(["node_modules", "target", ".git", "upstream", "dist", ".next"]),
): string[] {
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const p = join(root, e.name);
    if (e.isDirectory()) walk(p, match, out, skip);
    else if (match(p)) out.push(p);
  }
  return out;
}

export type Inventory = {
  generated: string;
  rust: Row[];
  bun: Row[];
  python: Row[];
  git: GitRow[];
  firstParty: { crates: number; versionDrift: string[]; nameTaken: string[]; aiCrates: number };
};

export async function inventory(
  root: string,
  opts: { pythonRoots?: string[]; log?: (m: string) => void } = {},
): Promise<Inventory> {
  const log = opts.log ?? (() => {});
  const cache = new Cache(join(root, "target", "deps-inventory", "cache"));

  // ---- Rust
  const lockPkgs = parseCargoLock(readFileSync(join(root, "Cargo.lock"), "utf8"));
  const wsToml = readFileSync(join(root, "Cargo.toml"), "utf8");
  const direct = new Set(
    [
      ...(/\[workspace\.dependencies\]([\s\S]*?)(?:\n\[|$)/.exec(wsToml)?.[1] ?? "").matchAll(
        /^([A-Za-z0-9_-]+)\s*=/gm,
      ),
    ].map((m) => m[1]!),
  );
  const registryPkgs = lockPkgs.filter((p) => p.source?.startsWith("registry+"));
  const names = [...new Set(registryPkgs.map((p) => p.name))];
  log(
    `rust: ${registryPkgs.length} registry packages (${names.length} crates), querying the sparse index`,
  );
  const infos = new Map<string, Awaited<ReturnType<typeof crateInfo>>>();
  await pool(names, 24, async (n) => {
    infos.set(n, await crateInfo(cache, n));
  });
  const rust: Row[] = registryPkgs.map((p) => {
    const i = infos.get(p.name)!;
    return {
      ecosystem: "crates.io",
      name: p.name,
      version: p.version,
      latest: i.latest,
      behind: !!i.latest && cmpVersion(p.version, i.latest) < 0,
      yanked: i.yanked.has(p.version),
      direct: direct.has(p.name),
    };
  });

  // ---- git sources (any host)
  const repos = gitSources(lockPkgs);
  log(`git: ${repos.size} remote(s)`);
  const git: GitRow[] = await pool([...repos.entries()], 4, async ([url, pinned]) => {
    const r = lsRemote(url);
    return {
      url,
      pinned: [...pinned].filter(Boolean).map((s) => s.slice(0, 12)),
      head: r.head?.slice(0, 12),
      latestTag: r.latestTag,
      stale: !!r.head && ![...pinned].some((p) => p && r.head!.startsWith(p.slice(0, 12))),
    };
  });

  // ---- first-party crates
  const manifests = walk(join(root, "crates"), (f) => f.endsWith("Cargo.toml"));
  const wsVersion = /^version\s*=\s*"([^"]+)"/m.exec(
    /\[workspace\.package\]([\s\S]*?)(?:\n\[|$)/.exec(wsToml)?.[1] ?? "",
  )?.[1];
  const drift: string[] = [];
  const own: string[] = [];
  for (const m of manifests) {
    const t = readFileSync(m, "utf8");
    const pkg = /\[package\]([\s\S]*?)(?:\n\[|$)/.exec(t)?.[1] ?? "";
    const name = /^name\s*=\s*"([^"]+)"/m.exec(pkg)?.[1];
    if (!name) continue;
    own.push(name);
    const v = /^version\s*=\s*"([^"]+)"/m.exec(pkg)?.[1];
    if (v && wsVersion && v.split("-")[0] !== wsVersion)
      drift.push(`${name} ${v} (workspace ${wsVersion})`);
  }
  log(`first-party: ${own.length} crates, checking crates.io name collisions`);
  const taken: string[] = [];
  await pool(own, 24, async (n) => {
    if ((await crateInfo(cache, n)).exists) taken.push(n);
  });

  // ---- Bun
  const bunLock = join(root, "bun.lock");
  const bunDeps = existsSync(bunLock) ? parseBunLock(readFileSync(bunLock, "utf8")) : [];
  const bunNames = [...new Set(bunDeps.map((d) => d.name))];
  log(`bun: ${bunDeps.length} resolved packages (${bunNames.length} names), querying npm`);
  const npm = new Map<string, Awaited<ReturnType<typeof npmInfo>>>();
  await pool(bunNames, 8, async (n) => {
    npm.set(n, await npmInfo(cache, n));
  });
  const declared = new Set<string>();
  for (const f of walk(root, (p) => p.endsWith("package.json"))) {
    try {
      const j = JSON.parse(readFileSync(f, "utf8")) as Record<
        string,
        Record<string, string> | undefined
      >;
      for (const k of [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
        "catalog",
      ])
        for (const n of Object.keys(j[k] ?? {})) declared.add(n);
    } catch {
      /* ignore malformed manifests */
    }
  }
  const bun: Row[] = bunDeps.map((d) => {
    const i = npm.get(d.name) ?? {};
    return Object.assign(d, {
      latest: i.latest,
      behind: !!i.latest && cmpVersion(d.version, i.latest) < 0,
      deprecated: i.deprecated,
      direct: declared.has(d.name),
    });
  });

  // ---- Python
  const pyRoots = [root, ...(opts.pythonRoots ?? [])].filter((r) => existsSync(r));
  const py = new Map<string, Dep>();
  for (const r of pyRoots) {
    for (const f of walk(
      r,
      (p) =>
        /(^|\/)(requirements[^/]*\.txt|uv\.lock)$/.test(p) && !p.startsWith(join(r, "docs") + "/"),
    ) /* docs/ holds vendored reference copies, never installed */) {
      const text = readFileSync(f, "utf8");
      for (const d of f.endsWith("uv.lock") ? parseUvLock(text) : parseRequirements(text))
        py.set(`${d.name}@${d.version}`, { ecosystem: "PyPI", ...d });
    }
  }
  log(`python: ${py.size} pinned package(s) under ${pyRoots.length} root(s)`);
  const python: Row[] = await pool([...py.values()], 12, async (d) => {
    const i = await pypiInfo(cache, d.name, d.version);
    return {
      ...d,
      latest: i.latest,
      behind: !!i.latest && cmpVersion(d.version, i.latest) < 0,
      yanked: i.yanked,
    };
  });

  // ---- OSV (one source for all three ecosystems)
  log("osv: querying advisories");
  const adv = await osv([...rust, ...bun, ...python]);
  for (const r of [...rust, ...bun, ...python])
    r.vulns = adv.get(`${r.ecosystem}:${r.name}@${r.version}`);

  return {
    generated: new Date().toISOString(),
    rust,
    bun,
    python,
    git,
    firstParty: {
      crates: own.length,
      versionDrift: drift,
      nameTaken: taken.toSorted(),
      aiCrates: own.filter((n) => /ai|llm|mcp|model|infer/.test(n)).length,
    },
  };
}

export function summarise(inv: Inventory, root: string): string {
  const holdFile = join(root, "tools/config/deps/advisory-holds.json");
  const holds: { ecosystem: string; name: string; reason: string }[] = existsSync(holdFile)
    ? (JSON.parse(readFileSync(holdFile, "utf8")).holds ?? [])
    : [];
  const sect = (title: string, rows: Row[]) => {
    const behind = rows.filter((r) => r.behind);
    const direct = behind.filter((r) => r.direct);
    const vuln = rows.filter((r) => r.vulns?.length);
    const bad = rows.filter((r) => r.yanked || r.deprecated);
    const lines = [
      `## ${title}`,
      "",
      `- resolved: ${rows.length}, behind latest: ${behind.length} (direct: ${direct.length}), with advisories: ${vuln.length}, yanked/deprecated: ${bad.length}`,
      "",
    ];
    const held = (r: Row) => holds.find((h) => h.ecosystem === r.ecosystem && h.name === r.name);
    const open = vuln.filter((r) => !held(r));
    const fixable = open.filter((r) => r.latest && cmpVersion(r.version, r.latest) < 0);
    const unfixed = open.filter((r) => !fixable.includes(r));
    const fmt = (r: Row) =>
      `- ${r.name} ${r.version}: ${r.vulns!.slice(0, 3).join(", ")}${r.latest ? ` (latest ${r.latest})` : ""}`;
    if (fixable.length)
      lines.push(
        "Open advisories with a newer release (bump or replace the consumer):",
        ...fixable.slice(0, 40).map(fmt),
        "",
      );
    if (unfixed.length)
      lines.push("Open advisories with no newer release:", ...unfixed.slice(0, 40).map(fmt), "");
    const heldRows = vuln.filter((r) => held(r));
    if (heldRows.length)
      lines.push(
        "Held advisories (reason in `tools/config/deps/advisory-holds.json`):",
        ...heldRows.slice(0, 60).map((r) => `${fmt(r)} - ${held(r)!.reason}`),
        "",
      );
    if (bad.length)
      lines.push(
        "Yanked or deprecated:",
        ...bad
          .slice(0, 25)
          .map(
            (r) =>
              `- ${r.name} ${r.version}${r.deprecated ? `: ${r.deprecated.slice(0, 100)}` : " (yanked)"}`,
          ),
        "",
      );
    if (direct.length)
      lines.push(
        "Direct dependencies behind latest:",
        ...direct.slice(0, 60).map((r) => `- ${r.name} ${r.version} -> ${r.latest}`),
        "",
      );
    return lines;
  };
  return [
    "<!-- SPDX-License-Identifier: Apache-2.0 -->",
    "# Dependency inventory",
    "",
    `Generated ${inv.generated} by \`yolo update deps inventory\` (crates.io sparse index, npm, PyPI, git ls-remote, OSV). Full data: \`${relative(root, join(root, "target/deps-inventory/inventory.json"))}\` (not committed).`,
    "",
    ...sect("Rust (Cargo.lock)", inv.rust),
    ...sect("Bun (bun.lock)", inv.bun),
    ...sect("Python (requirements, uv.lock)", inv.python),
    "## Git sources",
    "",
    ...inv.git.map(
      (g) =>
        `- ${g.url}: pinned ${g.pinned.join(", ") || "(tag)"}; remote HEAD ${g.head ?? "unreachable"}${g.latestTag ? `; newest tag ${g.latestTag}` : ""}${g.stale ? " - **HEAD moved**" : ""}`,
    ),
    "",
    "## First-party crates",
    "",
    `- ${inv.firstParty.crates} crates (${inv.firstParty.aiCrates} AI/MCP/model related by name)`,
    `- version drift from the workspace version (prerelease suffixes ignored; imported crates keep their upstream versions): ${inv.firstParty.versionDrift.length}`,
    ...inv.firstParty.versionDrift.slice(0, 20).map((d) => `  - ${d}`),
    `- names already on crates.io (vendored upstream crates such as taffy or whisper-rs-sys are expected; first-party names there are a publish-time collision): ${inv.firstParty.nameTaken.length}`,
    ...inv.firstParty.nameTaken.slice(0, 30).map((n) => `  - ${n}`),
    "",
  ].join("\n");
}

export function writeInventory(root: string, inv: Inventory): string {
  const dir = join(root, "target", "deps-inventory");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "inventory.json"), JSON.stringify(inv));
  const md = summarise(inv, root);
  const out = join(root, "docs", "reference", "workspace", "DEPS-INVENTORY.md");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, md);
  return out;
}
