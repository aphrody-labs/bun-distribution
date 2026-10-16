#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Compares RG and Shenron data across WSL, vps and dbfr (read-only):
 * 1. the most complete and freshest SQLite database of each domain;
 * 2. the freshest copy of each database package (@rosegriffon/db, @shenron/db).
 * Remote hosts run probe.ts through `ssh <host> bun run -`. Prints a Markdown
 * summary and writes the full JSON report outside the repository.
 *
 * Usage: bun scripts/audit/infra/db-compare/compare-rg-shenron.ts [--hosts local,vps,dbfr] [--out <file>]
 * RG lives in the IECODE monorepo: set IECODE_ROOT to include its local checkout.
 */
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import {
  probe,
  type Domain,
  type PackageCandidate,
  type ProbeInput,
  type ProbeOutput,
  type SqliteCandidate,
} from "./probe.ts";

const repo = new URL("../../../../../docs/aphrody/", import.meta.url).pathname.replace(/\/$/, "");
const home = homedir();
const iecode = process.env.IECODE_ROOT?.trim().replace(/\/+$/, "");
/** Paths in the local IECODE checkout; empty when IECODE_ROOT is not set. */
const rg = (relative: string): string[] => (iecode ? [`${iecode}/${relative}`] : []);
const today = new Date().toISOString().slice(0, 10);
const { values } = parseArgs({
  options: {
    hosts: { type: "string", default: "local,vps,dbfr" },
    out: {
      type: "string",
      default: `${home}/.aphrody/private/reports/db-compare-rg-shenron-${today}.json`,
    },
  },
});

const remoteHome = process.env.APHRODY_REMOTE_HOME?.trim().replace(/\/+$/, "");
/** Paths under the remote account home; empty when APHRODY_REMOTE_HOME is not set. */
const remote = (relative: string): string[] =>
  remoteHome ? [relative ? `${remoteHome}/${relative}` : remoteHome] : [];

/** The local aphrody-labs/shenron checkout: SHENRON_ROOT, else the sibling of this repository. */
const shenron = process.env.SHENRON_ROOT?.trim() || `${repo}/../shenron`;

const HOSTS: Record<string, Omit<ProbeInput, "host">> = {
  local: {
    sqliteRoots: [...rg("apps/rg"), `${shenron}/apps`, `${home}/.aphrody/private/backups`],
    packageRoots: [...rg("packages/rg"), `${shenron}/packages`],
    vecExtensionDirs: [`${repo}/node_modules/sqlite-vec-linux-x64`],
  },
  // Remote hosts: the account home comes from APHRODY_REMOTE_HOME, never from a fixed user name.
  vps: {
    sqliteRoots: [
      "/home/ubuntu/apps/rg",
      "/home/ubuntu/apps/shenron",
      ...remote("shenron"),
      "/var/backups/aphrody-unique",
    ],
    packageRoots: ["/home/ubuntu/apps/rg", "/home/ubuntu/apps/shenron", ...remote("")],
    vecExtensionDirs: [
      "/home/ubuntu/apps/shenron/current/node_modules/sqlite-vec-linux-x64",
      ...remote("shenron/node_modules/sqlite-vec-linux-x64"),
    ],
  },
  dbfr: {
    sqliteRoots: [...remote("shenron"), "/home/ubuntu/apps", "/var/backups/aphrody-unique"],
    packageRoots: [...remote(""), "/home/ubuntu/apps"],
    vecExtensionDirs: remote("shenron/node_modules/sqlite-vec-linux-x64"),
  },
};

const fmt = new Intl.NumberFormat("fr-FR");
const probeSource = Bun.file(new URL("./probe.ts", import.meta.url));

async function runHost(host: string): Promise<ProbeOutput> {
  const config = HOSTS[host];
  if (!config) throw new Error(`unknown host ${host}`);
  const input: ProbeInput = { host, ...config };
  if (host === "local") return probe(input);
  const payload = new TextEncoder().encode(JSON.stringify(input)).toBase64();
  const proc = Bun.spawn(
    ["ssh", "-o", "BatchMode=yes", host, `PROBE_INPUT=${payload} exec ~/.bun/bin/bun run -`],
    {
      windowsHide: true,
      stdin: probeSource,
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(20 * 60_000),
    },
  );
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`${host}: probe exited ${code}: ${err.trim().slice(0, 500)}`);
  return JSON.parse(out.trim().split("\n").at(-1)!) as ProbeOutput;
}

const freshness = (c: SqliteCandidate): string =>
  c.newestRow && c.newestRow > c.modified ? c.newestRow : c.modified;

/** Most complete first (rows), then freshest; integrity failures last. */
function bestSqlite(all: SqliteCandidate[], domain: Domain): SqliteCandidate | undefined {
  return all
    .filter((c) => c.domain === domain && !c.error)
    .toSorted(
      (a, b) =>
        Number(b.integrity === "ok") - Number(a.integrity === "ok") ||
        b.totalRows - a.totalRows ||
        freshness(b).localeCompare(freshness(a)),
    )[0];
}

function freshestPackage(all: PackageCandidate[], domain: Domain): PackageCandidate | undefined {
  return all
    .filter((p) => p.domain === domain)
    .toSorted(
      (a, b) => b.modified.localeCompare(a.modified) || Bun.semver.order(b.version, a.version),
    )[0];
}

function compareSqlite(rg: SqliteCandidate, sh: SqliteCandidate) {
  const rgTables = new Map(rg.tables.map((t) => [t.name, t]));
  const shTables = new Map(sh.tables.map((t) => [t.name, t]));
  const common = [...rgTables.keys()]
    .filter((n) => shTables.has(n))
    .toSorted()
    .map((name) => {
      const a = rgTables.get(name)!;
      const b = shTables.get(name)!;
      return {
        name,
        rows: { rg: a.rows, shenron: b.rows },
        columnsOnlyRg: a.columns.filter((c) => !b.columns.includes(c)),
        columnsOnlyShenron: b.columns.filter((c) => !a.columns.includes(c)),
      };
    });
  return {
    sameContent: rg.sha256 === sh.sha256,
    tablesOnlyRg: [...rgTables.keys()].filter((n) => !shTables.has(n)).toSorted(),
    tablesOnlyShenron: [...shTables.keys()].filter((n) => !rgTables.has(n)).toSorted(),
    commonTables: common,
  };
}

function comparePackages(rg: PackageCandidate, sh: PackageCandidate) {
  const deps = new Set([...Object.keys(rg.dependencies), ...Object.keys(sh.dependencies)]);
  const shared: { name: string; rg: string; shenron: string; same: boolean }[] = [];
  const onlyRg: string[] = [];
  const onlyShenron: string[] = [];
  for (const name of [...deps].toSorted()) {
    const a = rg.dependencies[name];
    const b = sh.dependencies[name];
    if (a && b) shared.push({ name, rg: a, shenron: b, same: a === b });
    else if (a) onlyRg.push(name);
    else onlyShenron.push(name);
  }
  const shByHash = new Map(sh.files.map((f) => [f.sha256, f.path]));
  const shByPath = new Map(sh.files.map((f) => [f.path, f]));
  const basename = (p: string) => p.split("/").at(-1)!;
  const shBase = new Set(sh.files.map((f) => basename(f.path)));
  return {
    versions: { rg: rg.version, shenron: sh.version },
    dependencies: { shared, onlyRg, onlyShenron },
    exports: {
      common: rg.exports.filter((e) => sh.exports.includes(e)),
      onlyRg: rg.exports.filter((e) => !sh.exports.includes(e)),
      onlyShenron: sh.exports.filter((e) => !rg.exports.includes(e)),
    },
    identicalFiles: rg.files
      .filter((f) => shByHash.has(f.sha256))
      .map((f) => ({ rg: f.path, shenron: shByHash.get(f.sha256)! })),
    samePathDifferentContent: rg.files
      .filter((f) => shByPath.has(f.path) && shByPath.get(f.path)!.sha256 !== f.sha256)
      .map((f) => f.path),
    sameModuleName: [
      ...new Set(
        rg.files.map((f) => basename(f.path)).filter((b) => shBase.has(b) && /\.tsx?$/.test(b)),
      ),
    ].toSorted(),
    declaredTables: {
      common: rg.declaredTables.filter((t) => sh.declaredTables.includes(t)),
      rgCount: rg.declaredTables.length,
      shenronCount: sh.declaredTables.length,
    },
  };
}

const where = (c: { host: string; path?: string; dir?: string }) => `${c.host}:${c.path ?? c.dir}`;
const list = (xs: string[], max = 12) =>
  xs.length
    ? `${xs.slice(0, max).join(", ")}${xs.length > max ? ` … (+${xs.length - max})` : ""}`
    : "—";

const hosts = values.hosts
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);
const settled = await Promise.allSettled(hosts.map(runHost));
const outputs = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
const failures = settled.flatMap((r, i) =>
  r.status === "rejected" ? [{ host: hosts[i]!, error: String(r.reason) }] : [],
);
const sqlite = outputs.flatMap((o) => o.sqlite);
const packages = outputs.flatMap((o) => o.packages);

const best = { rg: bestSqlite(sqlite, "rg"), shenron: bestSqlite(sqlite, "shenron") };
const pkg = { rg: freshestPackage(packages, "rg"), shenron: freshestPackage(packages, "shenron") };
const copiesOf = (c?: SqliteCandidate) =>
  c ? sqlite.filter((x) => x.sha256 === c.sha256 && x !== c).map(where) : [];

const report = {
  generatedAt: new Date().toISOString(),
  hosts: outputs.map((o) => ({
    host: o.host,
    bun: o.bun,
    sqlite: o.sqlite.length,
    packages: o.packages.length,
  })),
  failures,
  sqlite: {
    candidates: sqlite.map(({ tables, ...rest }) => ({ ...rest, tableCount: tables.length })),
    best: { rg: best.rg, shenron: best.shenron },
    identicalCopies: { rg: copiesOf(best.rg), shenron: copiesOf(best.shenron) },
    comparison: best.rg && best.shenron ? compareSqlite(best.rg, best.shenron) : null,
  },
  packages: {
    candidates: packages.map(({ files, ...rest }) => ({ ...rest, fileCount: files.length })),
    freshest: {
      rg: pkg.rg && { ...pkg.rg, files: pkg.rg.files.length },
      shenron: pkg.shenron && { ...pkg.shenron, files: pkg.shenron.files.length },
    },
    comparison: pkg.rg && pkg.shenron ? comparePackages(pkg.rg, pkg.shenron) : null,
  },
};

await Bun.write(values.out, JSON.stringify(report, null, 2));
await Bun.$`chmod 600 ${values.out}`.quiet();

const lines: string[] = [
  `# RG vs Shenron — bases SQLite et packages db (${report.generatedAt})`,
  "",
];
lines.push(
  `Hôtes : ${report.hosts.map((h) => `${h.host} (${h.sqlite} sqlite, ${h.packages} packages)`).join(", ")}`,
);
for (const f of failures) lines.push(`ÉCHEC ${f.host} : ${f.error}`);
lines.push(
  "",
  "## Candidats SQLite",
  "",
  "| domaine | hôte:chemin | Mo | lignes | tables | fraîcheur | intégrité |",
  "|---|---|--:|--:|--:|---|---|",
);
for (const c of [...sqlite].toSorted(
  (a, b) => a.domain.localeCompare(b.domain) || b.totalRows - a.totalRows,
)) {
  lines.push(
    `| ${c.domain} | ${where(c)} | ${(c.bytes / 1e6).toFixed(1)} | ${fmt.format(c.totalRows)} | ${c.tables.length} | ${freshness(c).slice(0, 16)} | ${c.error ? `erreur: ${c.error}` : c.integrity} |`,
  );
}
for (const d of ["rg", "shenron"] as const) {
  const b = best[d];
  lines.push(
    "",
    b
      ? `**Retenue ${d}** : ${where(b)} — ${fmt.format(b.totalRows)} lignes, ${b.tables.length} tables, fraîcheur ${freshness(b).slice(0, 16)}, copies identiques : ${list(copiesOf(b))}`
      : `**Retenue ${d}** : aucune base SQLite trouvée`,
  );
}
const sc = report.sqlite.comparison;
if (sc) {
  lines.push(
    "",
    "## Comparaison des deux bases SQLite",
    "",
    `Contenu identique : ${sc.sameContent ? "oui" : "non"}`,
  );
  lines.push(`Tables seulement rg (${sc.tablesOnlyRg.length}) : ${list(sc.tablesOnlyRg)}`);
  lines.push(
    `Tables seulement shenron (${sc.tablesOnlyShenron.length}) : ${list(sc.tablesOnlyShenron)}`,
  );
  lines.push(
    `Tables communes (${sc.commonTables.length}) : ${list(sc.commonTables.map((t) => `${t.name} (${fmt.format(t.rows.rg)}/${fmt.format(t.rows.shenron)})`))}`,
  );
}
lines.push(
  "",
  "## Packages db",
  "",
  "| domaine | hôte:dossier | nom@version | fichiers | modifié |",
  "|---|---|---|--:|---|",
);
for (const p of [...packages].toSorted(
  (a, b) => a.domain.localeCompare(b.domain) || b.modified.localeCompare(a.modified),
)) {
  lines.push(
    `| ${p.domain} | ${where(p)} | ${p.name}@${p.version} | ${p.files.length} | ${p.modified.slice(0, 16)} |`,
  );
}
for (const d of ["rg", "shenron"] as const) {
  const p = pkg[d];
  lines.push(
    "",
    p
      ? `**Plus frais ${d}** : ${where(p)} (${p.name}@${p.version}, ${p.modified.slice(0, 16)})`
      : `**Plus frais ${d}** : aucun package trouvé`,
  );
}
const pc = report.packages.comparison;
if (pc) {
  const diverging = pc.dependencies.shared.filter((d) => !d.same);
  lines.push("", "## Comparaison des deux packages db", "");
  lines.push(`Versions : rg ${pc.versions.rg} / shenron ${pc.versions.shenron}`);
  lines.push(
    `Dépendances communes (${pc.dependencies.shared.length}) : ${list(pc.dependencies.shared.map((d) => (d.same ? d.name : `${d.name} ${d.rg}≠${d.shenron}`)))}`,
  );
  lines.push(
    `Versions divergentes : ${list(diverging.map((d) => `${d.name} ${d.rg}≠${d.shenron}`))}`,
  );
  lines.push(`Dépendances seulement rg : ${list(pc.dependencies.onlyRg)}`);
  lines.push(`Dépendances seulement shenron : ${list(pc.dependencies.onlyShenron)}`);
  lines.push(
    `Exports communs : ${list(pc.exports.common)} ; seulement rg : ${list(pc.exports.onlyRg)} ; seulement shenron : ${list(pc.exports.onlyShenron)}`,
  );
  lines.push(
    `Fichiers identiques (doublons de code) : ${list(pc.identicalFiles.map((f) => (f.rg === f.shenron ? f.rg : `${f.rg}=${f.shenron}`)))}`,
  );
  lines.push(`Même chemin, contenu différent : ${list(pc.samePathDifferentContent)}`);
  lines.push(`Modules homonymes : ${list(pc.sameModuleName)}`);
  lines.push(
    `Tables déclarées : rg ${pc.declaredTables.rgCount}, shenron ${pc.declaredTables.shenronCount}, communes ${list(pc.declaredTables.common)}`,
  );
}
lines.push("", `Rapport JSON complet : ${values.out}`);
console.log(lines.join("\n"));
if (failures.length) process.exitCode = 1;
