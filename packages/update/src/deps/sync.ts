// SPDX-License-Identifier: Apache-2.0
/**
 * Dependency pipeline: registries -> plan/apply -> fact sheet -> pre-fix -> changelog -> agent memory.
 *
 * Registries: crates.io, npm, GitHub (releases), PyPI/GitHub (uv), Context7 (docs).
 * Cargo is never bulk-updated (repo rule): only the Tauri family is rewritten, the rest is reported.
 *
 * Usage: yolo update deps  (or: yolo update deps) [plan|apply|facts|fix|changelog|memory|inventory|baseline|run]
 *        [--apply] [--apply-fixes] [--all] [--json] [--root <repo>]
 *   plan       report outdated tools, Tauri family crates and Bun workspace (default)
 *   apply      rewrite pins, `uv self update`, `bun upgrade`, `bun update -r`, record the journal
 *   facts      fact-check changed libraries (GitHub notes + Context7 docs) into docs/research/workspace/deps/
 *   fix        pre-fix: run consumer gates, match failures to tools/config/deps/fix-rules.json, write a brief
 *   changelog  regenerate CHANGELOG.md from conventional commits + the dependency journal
 *   memory     write the managed deps block into every agent workspace (BOOT.md, memory/deps-state.md)
 *   inventory  whole-repo scan: crates.io, npm, PyPI, git remotes, OSV advisories, first-party crates
 *   baseline   record current consumer gate failures so `fix` only reports regressions
 *   run        plan, facts, fix, changelog (+ apply and memory with --apply)
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "../process.ts";
import { pluginStorePath } from "@aphrody/paths";
import { Ctx } from "../context.ts";

// ---------------------------------------------------------------- pure helpers (unit-tested)

const splitVersion = (v: string) => {
  const [core = "", pre = ""] = v.replace(/^[v=^~]/, "").split("-", 2);
  return { n: core.split(".").map((x) => Number.parseInt(x, 10) || 0), pre };
};

export function cmpVersion(a: string, b: string): number {
  const x = splitVersion(a);
  const y = splitVersion(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.n[i] ?? 0) - (y.n[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1; // a release outranks its prereleases
  if (!y.pre) return -1;
  const px = x.pre.split(".");
  const py = y.pre.split(".");
  for (let i = 0; i < Math.max(px.length, py.length); i++) {
    const p = px[i] ?? "";
    const q = py[i] ?? "";
    const pn = Number(p);
    const qn = Number(q);
    if (!Number.isNaN(pn) && !Number.isNaN(qn)) {
      if (pn !== qn) return pn < qn ? -1 : 1;
    } else if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

export type Commit = {
  hash: string;
  date: string;
  type: string;
  scope: string;
  subject: string;
  breaking: boolean;
};

export function parseCommit(hash: string, date: string, message: string): Commit | undefined {
  const m = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/.exec(message.split("\n")[0] ?? "");
  if (!m) return undefined;
  return {
    hash,
    date,
    type: m[1]!.toLowerCase(),
    scope: m[2] ?? "",
    subject: m[4]!,
    breaking: m[3] === "!" || /BREAKING CHANGE/.test(message),
  };
}

export type FixRule = {
  id: string;
  match: string;
  kind: "script" | "brief";
  note?: string;
  action?: string;
  files?: string[];
  pattern?: string;
};

export function matchRules(output: string, rules: FixRule[]): { rule: FixRule; lines: string[] }[] {
  const lines = output.split("\n");
  const hits: { rule: FixRule; lines: string[] }[] = [];
  for (const rule of rules) {
    const re = new RegExp(rule.match);
    const found = lines.filter((l) => re.test(l));
    if (found.length) hits.push({ rule, lines: found.slice(0, 5) });
  }
  return hits;
}

export const BLOCK_BEGIN = "<!-- aphrody:deps-sync:begin -->";
export const BLOCK_END = "<!-- aphrody:deps-sync:end -->";

export function replaceManagedBlock(text: string, body: string): string {
  const block = `${BLOCK_BEGIN}\n${body.trim()}\n${BLOCK_END}`;
  const a = text.indexOf(BLOCK_BEGIN);
  const b = text.indexOf(BLOCK_END);
  if (a >= 0 && b > a) return text.slice(0, a) + block + text.slice(b + BLOCK_END.length);
  return `${text.replace(/\s+$/, "")}\n\n${block}\n`;
}

export function normaliseErrors(output: string): string[] {
  return [
    ...new Set(
      output
        .split("\n")
        .filter((l) => /error(\[E\d+\]| TS\d+)/.test(l))
        .map((l) =>
          l
            .replace(/\(\d+,\d+\)/g, "")
            .replace(/:\d+:\d+/g, "")
            .trim(),
        ),
    ),
  ].toSorted();
}

// ---------------------------------------------------------------- registries

const UA = { "user-agent": "aphrody-deps-sync (contact@aphrody.com)" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, {
    headers: { ...UA, ...headers },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function githubHeaders(): Record<string, string> {
  let token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "";
  if (!token) {
    const r = spawnSync("gh", ["auth", "token"], { encoding: "utf8" });
    if (r.status === 0) token = r.stdout.trim();
  }
  return token
    ? { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" }
    : { accept: "application/vnd.github+json" };
}

export const registries = {
  async crate(name: string, major?: string): Promise<string | undefined> {
    const d = await getJson(`https://crates.io/api/v1/crates/${name}/versions`);
    await sleep(250); // crates.io crawler policy
    return (d.versions as { num: string; yanked: boolean }[]).find(
      (v) => !v.yanked && (!major || v.num.split(".")[0] === major),
    )?.num;
  },
  async npm(name: string): Promise<string | undefined> {
    const d = await getJson(`https://registry.npmjs.org/${name.replace("/", "%2f")}`);
    return d["dist-tags"]?.latest;
  },
  async pypi(name: string): Promise<string | undefined> {
    return (await getJson(`https://pypi.org/pypi/${name}/json`)).info?.version;
  },
  async github(repo: string): Promise<{ tag: string; body: string; url: string }[]> {
    const rels = await getJson(
      `https://api.github.com/repos/${repo}/releases?per_page=5`,
      githubHeaders(),
    );
    return (rels as any[]).map((r) => ({
      tag: String(r.tag_name),
      body: String(r.body ?? ""),
      url: String(r.html_url),
    }));
  },
  async context7(
    libId: string | undefined,
    name: string,
    topic: string,
    tokens = 1500,
  ): Promise<string> {
    const base = process.env.CONTEXT7_API_BASE || "https://context7.com/api";
    const headers: Record<string, string> = process.env.CONTEXT7_API_KEY
      ? { authorization: `Bearer ${process.env.CONTEXT7_API_KEY}` }
      : {};
    let id = libId;
    if (!id) {
      const s = await getJson(`${base}/v1/search?query=${encodeURIComponent(name)}`, headers);
      id = s.results?.[0]?.id;
      if (!id) return "";
    }
    const res = await fetch(
      `${base}/v1${id}?type=txt&topic=${encodeURIComponent(topic)}&tokens=${tokens}`,
      { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(30_000) },
    );
    return res.ok ? (await res.text()).trim() : "";
  },
};

// ---------------------------------------------------------------- context

export type Lib = {
  id: string;
  ecosystem: "cargo" | "npm" | "tool";
  name: string;
  github?: string;
  pypi?: string;
  context7?: string;
  topics?: string[];
};
export type Change = { ecosystem: string; name: string; from: string; to: string };
export type Journal = { seen: Record<string, string>; runs: { date: string; changes: Change[] }[] };

const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- plan / apply

async function currentVersions(c: Ctx): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const toml = c.read("Cargo.toml");
  for (const lib of c.watch().libs) {
    if (lib.ecosystem === "cargo") {
      const m = new RegExp(
        `^${lib.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*(?:\\{[^}]*version\\s*=\\s*)?"=?([^"]+)"`,
        "m",
      ).exec(toml);
      if (m) out[lib.id] = m[1]!;
    } else if (lib.ecosystem === "npm") {
      const pkg = c.read("package.json");
      const m = new RegExp(`"${lib.name.replace("/", "\\/")}"\\s*:\\s*"[\\^~]?([^"]+)"`).exec(pkg);
      if (m) out[lib.id] = m[1]!;
    } else {
      const r = c.run(lib.name, ["--version"]);
      const m = /\d+\.\d+\.\d+/.exec(r.stdout);
      if (m) out[lib.id] = m[0];
    }
  }
  return out;
}

async function plan(c: Ctx): Promise<Change[]> {
  // Tools: ../tools.ts + ../pins.ts. Tauri crates/npm/mirrors/schemas: ../tauri/sync.ts (single owner, honours minimumReleaseAge).
  const { runTauriSync } = await import("../tauri/sync.ts");
  const tauri = await runTauriSync(["--check", "--root", c.root]);
  const outdated = c
    .run("bun", ["outdated", "-r"])
    .stdout.split("\n")
    .filter((l) => /^\| [^-P]/.test(l)).length;
  if (!c.json)
    console.log(
      `info   bun outdated: ${outdated} rows (majors need a migration; \`bun update -r\` applies in-range only)`,
    );
  return tauri === 0
    ? []
    : [{ ecosystem: "cargo", name: "tauri-family", from: "drift", to: "see tauri-sync report" }];
}

async function applyChanges(c: Ctx, changes: Change[]): Promise<void> {
  if (changes.length) {
    const { runTauriSync } = await import("../tauri/sync.ts");
    await runTauriSync(["--apply", "--root", c.root]);
  }
  c.run("bun", ["update", "-r"], { inherit: true });
  const j = c.journal();
  const real = changes.filter((x) => x.from !== x.to);
  if (real.length) j.runs.push({ date: today(), changes: real });
  c.saveJournal(j);
}

// ---------------------------------------------------------------- facts

const BREAKING = /break|removed|deprecat|rename|migrat|no longer|drop/i;

const SECTION = /^## (.+) \S+ -> \S+$/;

/**
 * Merge freshly generated `## <library> <from> -> <to>` sections into the sheet already written that day: a section
 * replaces the one of the same library and every other section stays, so a second run never erases the first.
 */
export function mergeFactSheet(
  existing: string | undefined,
  header: string[],
  sections: Map<string, string[]>,
): string {
  const merged = new Map<string, string[]>();
  let name: string | undefined;
  for (const line of (existing ?? "").split("\n")) {
    const m = SECTION.exec(line);
    if (m) {
      name = m[1]!;
      merged.set(name, [line]);
    } else if (name) merged.get(name)!.push(line);
  }
  for (const body of merged.values()) while (body.length && body.at(-1) === "") body.pop();
  for (const [lib, body] of sections) {
    const trimmed = [...body];
    while (trimmed.length && trimmed.at(-1) === "") trimmed.pop();
    merged.set(lib, trimmed);
  }
  return [...header, ...[...merged.values()].flatMap((body) => body.concat(""))].join("\n");
}

async function facts(c: Ctx, all: boolean): Promise<string | undefined> {
  const watch = c.watch();
  const now = await currentVersions(c);
  const j = c.journal();
  const header = [
    `# Dependency fact sheet ${today()}`,
    "",
    "Generated by `yolo update deps facts` from GitHub releases and Context7. Verify before acting.",
    "",
  ];
  const sections = new Map<string, string[]>();
  for (const lib of watch.libs) {
    const cur = now[lib.id];
    const prev = j.seen[lib.id];
    if (!all && prev === cur) continue;
    if (!all && !cur) continue; // the version lookup failed: that is not a change
    if (!all && !prev) {
      j.seen[lib.id] = cur!;
      continue;
    } // first sighting: record, nothing to compare
    const lines: string[] = [`## ${lib.name} ${prev ?? "?"} -> ${cur ?? "?"}`, ""];
    if (lib.github) {
      // oxlint-disable-next-line no-await-in-loop -- sections séquentielles : ordre stable des fiches et limite de débit de l'API GitHub
      const rels = await registries.github(lib.github).catch((e: Error) => {
        lines.push(`GitHub: ${e.message}`);
        return [];
      });
      for (const r of rels.slice(0, 3)) {
        const hit = r.body
          .split("\n")
          .filter((l) => BREAKING.test(l))
          .slice(0, 8);
        lines.push(
          `- release ${r.tag} (${r.url})`,
          ...hit.map((l) => `  - ${l.trim().slice(0, 240)}`),
        );
      }
    }
    for (const topic of lib.topics ?? []) {
      // oxlint-disable-next-line no-await-in-loop -- requêtes Context7 séquentielles : limite de débit de l'API et ordre des sections
      const doc = await registries.context7(lib.context7, lib.name, topic).catch(() => "");
      if (doc)
        lines.push("", `### Context7: ${topic}`, "", doc.split("\n").slice(0, 20).join("\n"));
    }
    sections.set(lib.name, lines);
    if (cur) j.seen[lib.id] = cur;
  }
  c.saveJournal(j);
  const count = sections.size;
  if (!count) {
    console.log("facts  nothing changed since the last run");
    return undefined;
  }
  const file = `docs/research/workspace/deps/${today()}.md`;
  c.write(file, mergeFactSheet(c.exists(file) ? c.read(file) : undefined, header, sections));
  console.log(`facts  ${count} librar${count === 1 ? "y" : "ies"} -> ${file}`);
  return file;
}

// ---------------------------------------------------------------- fix (pre-fix)

function consumerTargets(c: Ctx, onlyChanged: string[]): { cargo: string[]; bun: string[] } {
  const w = c.watch();
  const ids = onlyChanged.length
    ? onlyChanged
    : Object.keys(w.consumers).filter((k) => k !== "note");
  const cargo = new Set<string>();
  const bun = new Set<string>();
  for (const id of ids) {
    for (const p of w.consumers[id]?.cargo ?? []) cargo.add(p);
    for (const d of w.consumers[id]?.bun ?? []) bun.add(d);
  }
  return { cargo: [...cargo], bun: [...bun] };
}

function globFiles(c: Ctx, patterns: string[]): string[] {
  const out: string[] = [];
  for (const p of patterns) for (const f of new Bun.Glob(p).scanSync({ cwd: c.root })) out.push(f);
  return out;
}

async function fix(c: Ctx, applyFixes: boolean, record = false): Promise<number> {
  const j = c.journal();
  const lastChanged = (j.runs.at(-1)?.changes ?? []).map((x) => x.name);
  const watch = c.watch();
  const ids = watch.libs
    .filter(
      (l) =>
        lastChanged.includes(l.name) ||
        lastChanged.some(
          (n) => l.ecosystem === "cargo" && n.startsWith("tauri") && l.id === "tauri",
        ),
    )
    .map((l) => l.id);
  const targets = consumerTargets(c, ids);
  let output = "";
  for (const d of targets.bun) {
    const r = c.run("bun", ["check", "--noEmit", "-p", join(d, "tsconfig.json")]);
    output += `\n# ${d}\n${r.stdout}${r.stderr}`;
  }
  if (targets.cargo.length) {
    const r = c.run("bash", [
      "scripts/build/rust/cargo-serial.sh",
      "check",
      ...targets.cargo.flatMap((p) => ["-p", p]),
    ]);
    output += `\n# cargo ${targets.cargo.join(" ")}\n${r.stdout}${r.stderr}`;
  }
  const baselineFile = "tools/config/deps/baseline.json";
  const errors = normaliseErrors(output);
  if (record) {
    c.write(baselineFile, `${JSON.stringify({ recorded: today(), errors }, null, 2)}\n`);
    console.log(`baseline recorded: ${errors.length} existing error line(s)`);
    return 0;
  }
  const known = new Set(c.jsonFile<{ errors: string[] }>(baselineFile, { errors: [] }).errors);
  const fresh = errors.filter((e) => !known.has(e));
  const rules = c.jsonFile<{ rules: FixRule[] }>("tools/config/deps/fix-rules.json", {
    rules: [],
  }).rules;
  const hits = matchRules(
    fresh.join("\n") +
      "\n" +
      output
        .split("\n")
        .filter((l) => /failed to select|no longer applies/.test(l))
        .join("\n"),
    rules,
  );
  console.log(
    `fix    ${targets.bun.length} Bun consumer(s), ${targets.cargo.length} Rust consumer(s), ${fresh.length} new error line(s)`,
  );
  const brief: string[] = [
    `# Dependency fix brief ${today()}`,
    "",
    `Changed: ${lastChanged.join(", ") || "(none)"}`,
    "",
  ];
  for (const { rule, lines } of hits) {
    console.log(
      `  rule ${rule.id} (${rule.kind}): ${lines.length} hit(s)${rule.note ? ` - ${rule.note}` : ""}`,
    );
    brief.push(
      `## ${rule.id} (${rule.kind})`,
      rule.note ?? "",
      ...lines.map((l) => `- \`${l.slice(0, 200)}\``),
      "",
    );
    if (
      applyFixes &&
      rule.kind === "script" &&
      rule.action === "strip-lines" &&
      rule.pattern &&
      rule.files
    ) {
      const re = new RegExp(`^[ \\t]*${rule.pattern}[ \\t]*\\r?\\n`, "gm");
      for (const f of globFiles(c, rule.files)) {
        const s = c.read(f);
        const n = s.replace(re, "");
        if (n !== s) {
          c.write(f, n);
          console.log(`  fixed ${f}`);
        }
      }
    }
  }
  const unmatched = fresh.filter((e) => !hits.some((h) => h.lines.includes(e)));
  if (unmatched.length)
    brief.push(
      "## Unmatched errors (agent)",
      "",
      ...unmatched.slice(0, 40).map((l) => `- \`${l.slice(0, 200)}\``),
      "",
    );
  if (fresh.length || hits.length) {
    c.write(`.coord/shared/deps-fix-${today()}.md`, brief.join("\n"));
    console.log(`brief  .coord/shared/deps-fix-${today()}.md`);
  }
  return fresh.length ? 1 : 0;
}

// ---------------------------------------------------------------- changelog

function changelog(c: Ctx): void {
  const cfg = c.jsonFile<{
    output: string;
    author: string;
    since: string;
    types: Record<string, string>;
    dependencyJournal: string;
  }>("tools/config/changelog.json", {
    output: "CHANGELOG.md",
    author: "aphrody-code",
    since: "2026-09-01",
    types: {},
    dependencyJournal: "tools/config/deps/journal.json",
  });
  const log = c.run("git", [
    "log",
    `--since=${cfg.since}`,
    `--author=${cfg.author}`,
    "--no-merges",
    "--format=%h%x1f%ad%x1f%B%x1e",
    "--date=short",
  ]).stdout;
  const commits = log
    .split("\x1e")
    .map((r) => r.trim())
    .filter(Boolean)
    .flatMap((r) => {
      const [h, d, ...m] = r.split("\x1f");
      const parsed = h && d ? parseCommit(h, d, m.join("\x1f")) : undefined;
      return parsed ? [parsed] : [];
    });
  const lines = [
    "<!-- SPDX-License-Identifier: Apache-2.0 -->",
    "# Changelog",
    "",
    "Generated by `yolo update deps changelog` from conventional commits and the dependency journal. Do not edit by hand.",
    "",
  ];
  const days = [...new Set(commits.map((x) => x.date))].toSorted().toReversed();
  for (const day of days) {
    lines.push(`## ${day}`, "");
    const dayCommits = commits.filter((x) => x.date === day);
    for (const [type, title] of Object.entries(cfg.types)) {
      const group = dayCommits.filter((x) => x.type === type);
      if (!group.length) continue;
      lines.push(
        `### ${title}`,
        "",
        ...group.map(
          (x) =>
            `- ${x.scope ? `**${x.scope}**: ` : ""}${x.subject}${x.breaking ? " **(breaking)**" : ""} (\`${x.hash}\`)`,
        ),
        "",
      );
    }
    for (const run of c.journal().runs.filter((r) => r.date === day)) {
      lines.push(
        "### Dependency bumps",
        "",
        ...run.changes.map((x) => `- ${x.ecosystem} ${x.name}: ${x.from} -> ${x.to}`),
        "",
      );
    }
  }
  c.write(cfg.output, lines.join("\n"));
  console.log(`changelog ${commits.length} commit(s) over ${days.length} day(s) -> ${cfg.output}`);
}

// ---------------------------------------------------------------- memory

async function memory(c: Ctx): Promise<void> {
  const now = await currentVersions(c);
  const j = c.journal();
  const last = j.runs.at(-1);
  const body = [
    `## Dependencies (managed by \`yolo update deps memory\`, ${today()})`,
    "",
    ...Object.entries(now).map(([k, v]) => `- ${k}: ${v}`),
    last
      ? `- last bump ${last.date}: ${last.changes.map((x) => `${x.name} ${x.from}->${x.to}`).join(", ")}`
      : "- no bump recorded yet",
    "",
    "Rules: run `bun run update:deps` (plan) before touching pins; after a bump read `docs/research/workspace/deps/` and",
    "`.coord/shared/deps-fix-*.md`; fix consumers with the briefs, never bulk-update Cargo; never edit CHANGELOG.md by hand.",
  ].join("\n");
  const base = process.env.APHRODY_WORKSPACES ?? join(homedir(), ".aphrody", "workspaces");
  const dirs = existsSync(base)
    ? readdirSync(base, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => join(base, d.name))
    : [];
  for (const dir of dirs) {
    const boot = join(dir, "BOOT.md");
    if (existsSync(boot))
      writeFileSync(boot, replaceManagedBlock(readFileSync(boot, "utf8"), body));
    mkdirSync(join(dir, "memory"), { recursive: true });
    writeFileSync(join(dir, "memory", "deps-state.md"), `# Dependency state\n\n${body}\n`);
    console.log(`memory ${dir}`);
  }
  // Canonical user-store boot template: static pointer, no volatile versions.
  const tpl = pluginStorePath("aphrody", "home", "BOOT.md");
  if (existsSync(tpl) && !readFileSync(tpl, "utf8").includes("update:deps")) {
    writeFileSync(
      tpl,
      `${readFileSync(tpl, "utf8").replace(/\s+$/, "")}\n6. **Dépendances :** exécuter \`bun run update:deps\` (plan) ; lire \`memory/deps-state.md\` et \`.coord/shared/deps-fix-*.md\` avant de toucher aux versions.\n`,
    );
  }
}

// ---------------------------------------------------------------- entry

export async function runDepsSync(argv: string[]): Promise<number> {
  const flag = (n: string) => argv.includes(n);
  const rootIdx = argv.indexOf("--root");
  const root = resolve(rootIdx >= 0 ? argv[rootIdx + 1]! : process.cwd());
  const sub = argv.find((a) => !a.startsWith("-") && a !== argv[rootIdx + 1]) ?? "plan";
  const c = new Ctx(root, flag("--apply"), flag("--json"));
  switch (sub) {
    case "plan":
      await plan(c);
      return 0;
    case "apply": {
      if (c.apply) await applyChanges(c, await plan(c));
      else console.log("pass --apply");
      return 0;
    }
    case "facts":
      await facts(c, flag("--all"));
      return 0;
    case "fix":
      return fix(c, flag("--apply-fixes"));
    case "baseline":
      return fix(c, false, true);
    case "changelog":
      changelog(c);
      return 0;
    case "memory":
      await memory(c);
      return 0;
    case "inventory": {
      const inv = await import("./inventory.ts");
      const roots =
        c.jsonFile<{ inventory?: { pythonRoots?: string[] } }>("tools/config/deps/watch.json", {})
          .inventory?.pythonRoots ?? [];
      const data = await inv.inventory(c.root, {
        pythonRoots: roots.map((r) => r.replace(/^~/, homedir())),
        log: (m) => console.log(`inv    ${m}`),
      });
      console.log(`inv    wrote ${inv.writeInventory(c.root, data)}`);
      return 0;
    }
    case "run": {
      const changes = await plan(c);
      if (c.apply) await applyChanges(c, changes);
      await facts(c, flag("--all"));
      const code = await fix(c, flag("--apply-fixes"));
      changelog(c);
      if (c.apply) await memory(c);
      return code;
    }
    default:
      console.error(`unknown subcommand ${sub}`);
      return 2;
  }
}
