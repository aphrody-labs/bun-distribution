// Integrate an upstream Cargo workspace into aphrody's single workspace domain.
//
// The whole repository is copied (minus .git and lockfiles). Every member manifest is made
// self-contained: `workspace = true` package fields and dependencies are resolved from the
// upstream root, path dependencies are rewritten relative to the crate, and [lints] become
// allow-all (vendored code is not held to the aphrody gate). The upstream root manifest is
// kept as Cargo.upstream.toml; if it also declares a package (Nushell's `nu`), that package
// is emitted as a regular member manifest.
//
// usage: bun scripts/absorb-upstream.ts <src> <dest-rel> <name> <commit> <member-glob...> -- <exclude-glob...>
import { parse, stringify } from "smol-toml";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

// Repository root: the parent of this scripts/ directory.
const ROOT = process.env.ABSORB_ROOT ?? join(import.meta.dir, "..");
const [src, destRel, name, commit, ...rest] = process.argv.slice(2);
const sep = rest.indexOf("--");
const memberGlobs = sep < 0 ? rest : rest.slice(0, sep);
const excludeGlobs = sep < 0 ? [] : rest.slice(sep + 1);
const dest = join(ROOT, destRel);
const fwd = (p: string) => p.replaceAll("\\", "/");

// 1. Copy the tree.
if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
const SKIP = new Set([".git", "node_modules", "target"]);
cpSync(src, dest, {
  recursive: true,
  filter: (p) => {
    const base = p.split(/[\\/]/).pop()!;
    if (SKIP.has(base)) return false;
    if (base === "Cargo.lock" || base === "pnpm-lock.yaml") return false;
    return true;
  },
});

// 2. Upstream workspace definitions.
const upstreamRootText = readFileSync(join(src, "Cargo.toml"), "utf8");
const upstreamRoot = parse(upstreamRootText) as any;
const wsPkg = upstreamRoot.workspace?.package ?? {};
const wsDeps = upstreamRoot.workspace?.dependencies ?? {};

// 3. Expand member globs (single `*` segments) relative to dest.
const expand = (glob: string): string[] => {
  const parts = glob.split("/");
  let acc = [""];
  for (const part of parts) {
    const next: string[] = [];
    for (const base of acc) {
      if (part === "*") {
        const dir = join(dest, base);
        if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
        for (const e of readdirSync(dir)) if (statSync(join(dir, e)).isDirectory()) next.push(base ? `${base}/${e}` : e);
      } else next.push(base ? `${base}/${part}` : part);
    }
    acc = next;
  }
  return acc.filter((p) => existsSync(join(dest, p, "Cargo.toml")));
};
const excluded = new Set(excludeGlobs.flatMap(expand));
const globs = memberGlobs.length ? memberGlobs : ((parse(readFileSync(join(src, "Cargo.toml"), "utf8")) as any).workspace?.members ?? []);
const members = [...new Set(globs.flatMap(expand))].filter((m) => !excluded.has(m)).toSorted();
// Path dependencies inside the tree are implicit workspace members (cargo rule): follow them.
{
  const pathDepsOf = (dir: string): string[] => {
    const m = parse(readFileSync(join(dest, dir, "Cargo.toml"), "utf8").replace(/^\uFEFF/, "")) as any;
    const out: string[] = [];
    const scan = (t: any) => {
      for (const table of ["dependencies", "dev-dependencies", "build-dependencies"]) {
        for (const [key, v] of Object.entries(t?.[table] ?? {}) as any) {
          let p: string | undefined = v?.path;
          if (p) p = fwd(relative(dest, join(dest, dir, p)));
          else if (v?.workspace === true && wsDeps[key]?.path) p = fwd(wsDeps[key].path);
          if (p !== undefined && !p.startsWith("..")) out.push(p.replace(/^\.\/?/, "").replace(/\/$/, ""));
        }
      }
      for (const cfg of Object.values(t?.target ?? {})) scan(cfg);
    };
    scan(m);
    return out;
  };
  const queue = [...members, ...(upstreamRoot.package ? [""] : [])];
  const seen = new Set(members);
  while (queue.length) {
    const d = queue.pop()!;
    for (const p of pathDepsOf(d)) {
      if (seen.has(p) || p === "" || !existsSync(join(dest, p, "Cargo.toml"))) continue;
      seen.add(p);
      members.push(p);
      queue.push(p);
    }
  }
  members.sort();
}

const ALLOW_LINTS = {
  rust: { warnings: "allow", unused: { level: "allow", priority: -1 }, deprecated: "allow", unexpected_cfgs: "allow" },
  clippy: { all: { level: "allow", priority: -1 }, pedantic: { level: "allow", priority: -1 } },
};

const resolveDep = (key: string, dep: any, crateDir: string) => {
  if (typeof dep !== "object" || dep === null || dep.workspace !== true) {
    if (typeof dep === "object" && dep?.path) {
      // Upstream path deps stay valid inside the copied tree; nothing to do.
    }
    return dep;
  }
  const baseRaw = wsDeps[key];
  if (baseRaw === undefined) throw new Error(`${crateDir}: ${key} inherits a workspace dependency upstream does not declare`);
  const base = typeof baseRaw === "string" ? { version: baseRaw } : { ...baseRaw };
  if (base.path) base.path = fwd(relative(join(dest, crateDir), join(dest, base.path))) || ".";
  const out: any = { ...base };
  const features = [...new Set([...(base.features ?? []), ...(dep.features ?? [])])];
  if (features.length) out.features = features;
  if (dep.optional) out.optional = true;
  if (dep["default-features"] === false || dep.default_features === false) out["default-features"] = false;
  delete out.workspace;
  return out;
};
const fixDepTables = (m: any, crateDir: string) => {
  for (const t of ["dependencies", "dev-dependencies", "build-dependencies"]) {
    if (!m[t]) continue;
    for (const [k, v] of Object.entries(m[t])) m[t][k] = resolveDep(k, v, crateDir);
  }
  if (m.target) for (const cfg of Object.values(m.target) as any[]) fixDepTables(cfg, crateDir);
};
const fixManifest = (m: any, crateDir: string) => {
  if (m.package) {
    for (const [k, v] of Object.entries(m.package)) {
      if (typeof v === "object" && v !== null && (v as any).workspace === true) {
        if (wsPkg[k] === undefined) throw new Error(`${crateDir}: package.${k} inherits an undeclared workspace value`);
        m.package[k] = wsPkg[k];
      }
    }
    delete m.package.workspace;
  }
  fixDepTables(m, crateDir);
  m.lints = ALLOW_LINTS;
  delete m.workspace;
  delete m.profile;
  delete m.patch;
  delete m.replace;
  return m;
};

// 4. Rewrite member manifests; park the upstream root manifest.
writeFileSync(join(dest, "Cargo.upstream.toml"), upstreamRootText);
const rootIsPackage = !!upstreamRoot.package;
for (const mem of members) {
  const f = join(dest, mem, "Cargo.toml");
  const m = mem === "" || mem === "." ? structuredClone(upstreamRoot) : (parse(readFileSync(f, "utf8").replace(/^\uFEFF/, "")) as any);
  writeFileSync(f, `# Vendored from ${name} at ${commit}; generated by the aphrody absorb step (see ../${fwd(relative(join(dest, mem), dest)) || "."}/UPSTREAM.txt).\n${stringify(fixManifest(m, mem))}\n`);
}
if (rootIsPackage) {
  writeFileSync(join(dest, "Cargo.toml"), `# Vendored from ${name} at ${commit}; generated by the aphrody absorb step (see UPSTREAM.txt).\n${stringify(fixManifest(structuredClone(upstreamRoot), "."))}\n`);
} else {
  rmSync(join(dest, "Cargo.toml"));
}
// Non-member manifests that still declare [workspace] would hijack workspace discovery.
const walk = (dir: string, out: string[]) => {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e === "Cargo.toml") out.push(p);
  }
};
const all: string[] = [];
walk(dest, all);
const memberSet = new Set(members.map((m) => fwd(join(dest, m, "Cargo.toml"))));
if (rootIsPackage) memberSet.add(fwd(join(dest, "Cargo.toml")));
const nonMembers = all.map(fwd).filter((f) => !memberSet.has(f));

writeFileSync(
  join(dest, "UPSTREAM.txt"),
  `${name} vendored from ${commit}.\n` +
    `Whole repository copied except .git, target, node_modules and lockfiles.\n` +
    `Member manifests are generated: inherited workspace fields and dependencies are resolved from\n` +
    `Cargo.upstream.toml (the original root manifest), and [lints] are allow-all.\n` +
    `Workspace members (${members.length + (rootIsPackage ? 1 : 0)}): ${[rootIsPackage ? "." : null, ...members].filter(Boolean).join(", ")}\n` +
    `Not members (need an upstream frontend or toolchain): ${nonMembers.map((f) => fwd(relative(dest, dirname(f)))).join(", ") || "none"}\n`,
);
const rel = (m: string) => fwd(join(destRel, m));
console.log(JSON.stringify({ members: [...(rootIsPackage ? [destRel] : []), ...members.map(rel)], nonMembers: nonMembers.map((f) => fwd(relative(ROOT, dirname(f)))) }, null, 1));
